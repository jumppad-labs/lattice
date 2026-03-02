package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
	"time"

	"connectrpc.com/connect"
	"github.com/hashicorp/serf/serf"
	observerv1 "github.com/jumppad-labs/lattice/pkg/api/observer/v1"
	"github.com/jumppad-labs/lattice/pkg/api/observer/v1/observerapiconnect"
	latticeserf "github.com/jumppad-labs/lattice/internal/serf"
	"google.golang.org/protobuf/encoding/protojson"
)

// ObserverService implements the Observer API
type ObserverService struct {
	mesh      *latticeserf.Mesh
	mu        sync.RWMutex
	watchers  map[chan *observerv1.TopologyUpdate]struct{}
}

// NewObserverService creates a new ObserverService
func NewObserverService(mesh *latticeserf.Mesh) *ObserverService {
	svc := &ObserverService{
		mesh:     mesh,
		watchers: make(map[chan *observerv1.TopologyUpdate]struct{}),
	}

	// Register callbacks for mesh events
	mesh.OnJoin(func(member *latticeserf.Member) {
		svc.notifyWatchers()
	})

	mesh.OnLeave(func(member *latticeserf.Member) {
		svc.notifyWatchers()
	})

	return svc
}

// Verify interface implementation
var _ observerapiconnect.ObserverServiceHandler = (*ObserverService)(nil)

// GetTopology returns the current topology snapshot
func (s *ObserverService) GetTopology(
	ctx context.Context,
	req *connect.Request[observerv1.GetTopologyRequest],
) (*connect.Response[observerv1.GetTopologyResponse], error) {
	topology := s.buildTopology()

	resp := &observerv1.GetTopologyResponse{
		Topology: topology,
	}

	return connect.NewResponse(resp), nil
}

// WatchTopology streams topology updates in real-time
func (s *ObserverService) WatchTopology(
	ctx context.Context,
	req *connect.Request[observerv1.WatchTopologyRequest],
	stream *connect.ServerStream[observerv1.TopologyUpdate],
) error {
	// Send initial topology
	initialTopology := s.buildTopology()
	if err := stream.Send(&observerv1.TopologyUpdate{
		Topology:   initialTopology,
		UpdateType: observerv1.UpdateType_UPDATE_TYPE_FULL,
	}); err != nil {
		return err
	}

	// Create channel for updates
	updateCh := make(chan *observerv1.TopologyUpdate, 10)

	s.mu.Lock()
	s.watchers[updateCh] = struct{}{}
	s.mu.Unlock()

	// Clean up on exit
	defer func() {
		s.mu.Lock()
		delete(s.watchers, updateCh)
		s.mu.Unlock()
		close(updateCh)
	}()

	// Stream updates
	for {
		select {
		case <-ctx.Done():
			return nil
		case update := <-updateCh:
			if err := stream.Send(update); err != nil {
				return err
			}
		}
	}
}

// GetServiceResources fetches resource metadata from a Loki service via RPC
func (s *ObserverService) GetServiceResources(
	ctx context.Context,
	req *connect.Request[observerv1.GetServiceResourcesRequest],
) (*connect.Response[observerv1.GetServiceResourcesResponse], error) {
	// Find the service in the current topology
	topology := s.buildTopology()
	var targetService *observerv1.Service
	for _, svc := range topology.Services {
		if svc.Name == req.Msg.ServiceName {
			targetService = svc
			break
		}
	}

	if targetService == nil {
		return nil, connect.NewError(connect.CodeNotFound,
			fmt.Errorf("service %q not found", req.Msg.ServiceName))
	}

	// Find path to target node using topology graph
	graph := s.mesh.Graph()
	path := graph.FindPath("lattice", targetService.NodeName)

	if path == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("no route to node %q", targetService.NodeName))
	}

	// Determine entry point (first Loki node in path)
	var entryNode string
	if len(path) > 1 {
		entryNode = path[1] // Skip "lattice", get first Polymorph node
	} else {
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("invalid path: %v", path))
	}

	// Find entry node's service address
	var entryAddr string
	for _, svc := range topology.Services {
		if svc.NodeName == entryNode {
			entryAddr = svc.Address
			break
		}
	}

	if entryAddr == "" {
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("no service address for entry node %q", entryNode))
	}

	// Build RPC request with path
	serviceURL := fmt.Sprintf("http://%s/meta.v1.LokiMetaService/GetResources", entryAddr)
	reqBody := map[string]any{
		"serviceName": req.Msg.ServiceName,
		"path":        path[1:], // Remove "lattice" from path
		"currentHop":  0,
	}
	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Make HTTP POST request
	httpReq, err := http.NewRequestWithContext(ctx, "POST", serviceURL, bytes.NewReader(reqJSON))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	httpResp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("failed to connect to Loki service: %w", err))
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(httpResp.Body)
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("Loki returned status %d: %s", httpResp.StatusCode, string(body)))
	}

	// Parse response
	var lokiResp struct {
		Services []struct {
			ServiceName string `json:"serviceName"`
			Resources   []struct {
				Name       string `json:"name"`
				RowCount   int32  `json:"rowCount"`
				PluralName string `json:"pluralName"`
				Fields     []struct {
					Name   string    `json:"name"`
					Type   string    `json:"type"`
					Values []string  `json:"values,omitempty"`
					Min    *float64  `json:"min,omitempty"`
					Max    *float64  `json:"max,omitempty"`
				} `json:"fields"`
			} `json:"resources"`
		} `json:"services"`
	}

	if err := json.NewDecoder(httpResp.Body).Decode(&lokiResp); err != nil {
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("failed to parse Loki response: %w", err))
	}

	// Convert to Lattice format
	var resources []*observerv1.Resource
	for _, svcRes := range lokiResp.Services {
		for _, res := range svcRes.Resources {
			fields := make([]*observerv1.Field, 0, len(res.Fields))
			for _, field := range res.Fields {
				fields = append(fields, &observerv1.Field{
					Name:   field.Name,
					Type:   field.Type,
					Values: field.Values,
					Min:    field.Min,
					Max:    field.Max,
				})
			}

			resources = append(resources, &observerv1.Resource{
				Name:       res.Name,
				RowCount:   res.RowCount,
				Fields:     fields,
				PluralName: res.PluralName,
			})
		}
	}

	resp := &observerv1.GetServiceResourcesResponse{
		Resources: resources,
	}

	return connect.NewResponse(resp), nil
}

// GetRequestLogs fetches recent HTTP request logs for a service
func (s *ObserverService) GetRequestLogs(
	ctx context.Context,
	req *connect.Request[observerv1.GetRequestLogsRequest],
) (*connect.Response[observerv1.GetRequestLogsResponse], error) {
	// Find the service in the current topology
	topology := s.buildTopology()
	var targetService *observerv1.Service
	for _, svc := range topology.Services {
		if svc.Name == req.Msg.ServiceName {
			targetService = svc
			break
		}
	}

	if targetService == nil {
		return nil, connect.NewError(connect.CodeNotFound,
			fmt.Errorf("service %q not found", req.Msg.ServiceName))
	}

	// Find path to target node using topology graph
	graph := s.mesh.Graph()
	path := graph.FindPath("lattice", targetService.NodeName)

	if path == nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("no route to node %q", targetService.NodeName))
	}

	// Determine entry point (first Loki node in path)
	var entryNode string
	if len(path) > 1 {
		entryNode = path[1] // Skip "lattice", get first Polymorph node
	} else {
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("invalid path: %v", path))
	}

	// Find entry node's service address
	var entryAddr string
	for _, svc := range topology.Services {
		if svc.NodeName == entryNode {
			entryAddr = svc.Address
			break
		}
	}

	if entryAddr == "" {
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("no service address for entry node %q", entryNode))
	}

	// Build RPC request with path
	serviceURL := fmt.Sprintf("http://%s/meta.v1.LokiMetaService/GetRequestLogs", entryAddr)
	reqBody := map[string]any{
		"serviceName":   req.Msg.ServiceName,
		"afterSequence": req.Msg.AfterSequence,
		"limit":         req.Msg.Limit,
		"path":          path[1:], // Remove "lattice" from path
		"currentHop":    0,
	}
	reqJSON, err := json.Marshal(reqBody)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Make HTTP POST request
	httpReq, err := http.NewRequestWithContext(ctx, "POST", serviceURL, bytes.NewReader(reqJSON))
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	httpReq.Header.Set("Content-Type", "application/json")

	httpResp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable,
			fmt.Errorf("failed to connect to Loki service: %w", err))
	}
	defer httpResp.Body.Close()

	if httpResp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(httpResp.Body)
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("Loki returned status %d: %s", httpResp.StatusCode, string(body)))
	}

	// Parse response using protobuf JSON unmarshaler (handles uint64/enum strings)
	body, err := io.ReadAll(httpResp.Body)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("failed to read response body: %w", err))
	}

	resp := &observerv1.GetRequestLogsResponse{}
	if err := protojson.Unmarshal(body, resp); err != nil {
		return nil, connect.NewError(connect.CodeInternal,
			fmt.Errorf("failed to parse Loki response: %w", err))
	}

	return connect.NewResponse(resp), nil
}

// ServiceInfo represents service metadata from Loki
// Only includes basic discovery info - resource metadata is fetched via RPC
type ServiceInfo struct {
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Address   string   `json:"address"`
	Upstreams []string `json:"upstreams,omitempty"`
}

// buildTopology builds the current topology from mesh members
func (s *ObserverService) buildTopology() *observerv1.Topology {
	members := s.mesh.Members()
	services := make([]*observerv1.Service, 0)

	for _, member := range members {
		// Check if member has JSON-encoded services (new format)
		if servicesJSON, ok := member.Tags["services"]; ok {
			// Parse JSON array of services
			var serviceInfos []ServiceInfo
			if err := json.Unmarshal([]byte(servicesJSON), &serviceInfos); err != nil {
				// Log error but continue
				continue
			}

			// Create a Service entry for each service in this node
			for _, info := range serviceInfos {
				service := &observerv1.Service{
					Name:      info.Name,
					Type:      info.Type,
					Address:   info.Address,
					NodeName:  member.Name,
					Upstreams: info.Upstreams,
					Status:    mapStatus(member.Status),
					Tags:      member.Tags,
					// Resources are fetched via RPC on-demand
				}
				services = append(services, service)
			}
		} else if member.Tags["service_type"] != "" {
			// Fallback to old format for backwards compatibility
			service := &observerv1.Service{
				Name:     member.Tags["service_name"],
				Type:     member.Tags["service_type"],
				Address:  member.Addr,
				NodeName: member.Name,
				Status:   mapStatus(member.Status),
				Tags:     member.Tags,
			}
			services = append(services, service)
		}
		// Skip lattice-only nodes (no services tag)
	}

	return &observerv1.Topology{
		Services:  services,
		Timestamp: time.Now().UnixMilli(),
	}
}

// notifyWatchers sends topology updates to all watchers
func (s *ObserverService) notifyWatchers() {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if len(s.watchers) == 0 {
		return
	}

	topology := s.buildTopology()
	update := &observerv1.TopologyUpdate{
		Topology:   topology,
		UpdateType: observerv1.UpdateType_UPDATE_TYPE_FULL,
	}

	for ch := range s.watchers {
		select {
		case ch <- update:
		default:
			// Skip if channel is full
		}
	}
}

// mapStatus maps Serf status to ServiceStatus
func mapStatus(status string) observerv1.ServiceStatus {
	switch status {
	case serf.StatusAlive.String():
		return observerv1.ServiceStatus_SERVICE_STATUS_HEALTHY
	case serf.StatusLeaving.String(), serf.StatusLeft.String():
		return observerv1.ServiceStatus_SERVICE_STATUS_UNHEALTHY
	case serf.StatusFailed.String():
		return observerv1.ServiceStatus_SERVICE_STATUS_UNHEALTHY
	default:
		return observerv1.ServiceStatus_SERVICE_STATUS_UNKNOWN
	}
}
