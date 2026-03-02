package serf

import (
	"context"
	"fmt"
	"log"
	"sync"

	"github.com/hashicorp/serf/serf"
	"github.com/jumppad-labs/lattice/internal/topology"
)

// MeshConfig contains configuration for creating a new Mesh
type MeshConfig struct {
	// NodeName is the name of this node in the mesh
	NodeName string

	// BindAddr is the address to bind the gossip listener to
	BindAddr string

	// BindPort is the port to bind the gossip listener to
	BindPort int

	// Tags are metadata tags for this node
	Tags map[string]string

	// JoinAddrs are addresses of existing nodes to join
	JoinAddrs []string
}

// Member represents a member in the mesh
type Member struct {
	// Name is the unique name of the member
	Name string

	// Addr is the address of the member
	Addr string

	// Port is the port of the member
	Port uint16

	// Tags are metadata tags for the member
	Tags map[string]string

	// Status is the status of the member (alive, leaving, left, failed)
	Status string
}

// Mesh manages a Serf gossip mesh for service discovery
type Mesh struct {
	serf    *serf.Serf
	members sync.Map
	config  MeshConfig

	// Event callbacks
	joinCallbacks  []func(*Member)
	leaveCallbacks []func(*Member)
	mu             sync.RWMutex

	// Topology graph
	graph *topology.Graph

	// Event channel for processing events
	eventCh chan serf.Event
	stopCh  chan struct{}
	stopped bool
	stopMu  sync.Mutex
}

// NewMesh creates a new Mesh with the given configuration
func NewMesh(config MeshConfig) (*Mesh, error) {
	if config.NodeName == "" {
		return nil, fmt.Errorf("node name is required")
	}

	if config.BindAddr == "" {
		config.BindAddr = "0.0.0.0"
	}

	// Note: BindPort of 0 means let the OS choose a random port
	// Default to 7946 only if not explicitly set during Start

	m := &Mesh{
		config:  config,
		eventCh: make(chan serf.Event, 256),
		stopCh:  make(chan struct{}),
		graph:   topology.NewGraph(),
	}

	return m, nil
}

// Start initializes and starts the Serf mesh
func (m *Mesh) Start(ctx context.Context) error {
	// Create Serf configuration
	conf := serf.DefaultConfig()
	conf.NodeName = m.config.NodeName
	conf.MemberlistConfig.BindAddr = m.config.BindAddr
	conf.MemberlistConfig.BindPort = m.config.BindPort
	conf.Tags = m.config.Tags
	conf.EventCh = m.eventCh

	// Create Serf instance
	s, err := serf.Create(conf)
	if err != nil {
		return fmt.Errorf("failed to create serf instance: %w", err)
	}

	m.serf = s

	// Start event processing
	go m.processEvents(ctx)

	// Join existing cluster if addresses provided
	if len(m.config.JoinAddrs) > 0 {
		_, err := m.serf.Join(m.config.JoinAddrs, false)
		if err != nil {
			return fmt.Errorf("failed to join cluster: %w", err)
		}
	}

	return nil
}

// Stop shuts down the mesh
func (m *Mesh) Stop() error {
	m.stopMu.Lock()
	defer m.stopMu.Unlock()

	if m.stopped {
		return nil
	}

	if m.serf == nil {
		m.stopped = true
		return nil
	}

	close(m.stopCh)
	m.stopped = true

	err := m.serf.Leave()
	if err != nil {
		return fmt.Errorf("failed to leave cluster: %w", err)
	}

	err = m.serf.Shutdown()
	if err != nil {
		return fmt.Errorf("failed to shutdown serf: %w", err)
	}

	return nil
}

// Members returns a list of all members in the mesh
func (m *Mesh) Members() []*Member {
	if m.serf == nil {
		return nil
	}

	serfMembers := m.serf.Members()
	members := make([]*Member, 0, len(serfMembers))

	for _, sm := range serfMembers {
		member := &Member{
			Name:   sm.Name,
			Addr:   sm.Addr.String(),
			Port:   sm.Port,
			Tags:   sm.Tags,
			Status: sm.Status.String(),
		}
		members = append(members, member)
	}

	return members
}

// OnJoin registers a callback to be called when a member joins
func (m *Mesh) OnJoin(fn func(*Member)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.joinCallbacks = append(m.joinCallbacks, fn)
}

// OnLeave registers a callback to be called when a member leaves
func (m *Mesh) OnLeave(fn func(*Member)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.leaveCallbacks = append(m.leaveCallbacks, fn)
}

// processEvents processes Serf events from the event channel
func (m *Mesh) processEvents(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case <-m.stopCh:
			return
		case e := <-m.eventCh:
			m.handleEvent(e)
		}
	}
}

// handleEvent handles a single Serf event
func (m *Mesh) handleEvent(e serf.Event) {
	switch e.EventType() {
	case serf.EventMemberJoin:
		m.handleMemberJoin(e.(serf.MemberEvent))
	case serf.EventMemberLeave, serf.EventMemberFailed:
		m.handleMemberLeave(e.(serf.MemberEvent))
	case serf.EventMemberUpdate:
		m.handleMemberUpdate(e.(serf.MemberEvent))
	case serf.EventUser:
		m.handleUserEvent(e.(serf.UserEvent))
	}
}

// handleMemberJoin handles member join events
func (m *Mesh) handleMemberJoin(e serf.MemberEvent) {
	for _, sm := range e.Members {
		member := &Member{
			Name:   sm.Name,
			Addr:   sm.Addr.String(),
			Port:   sm.Port,
			Tags:   sm.Tags,
			Status: sm.Status.String(),
		}

		m.members.Store(sm.Name, member)

		// Trigger callbacks
		m.mu.RLock()
		callbacks := m.joinCallbacks
		m.mu.RUnlock()

		for _, fn := range callbacks {
			go fn(member)
		}
	}
}

// handleMemberLeave handles member leave/failed events
func (m *Mesh) handleMemberLeave(e serf.MemberEvent) {
	for _, sm := range e.Members {
		member := &Member{
			Name:   sm.Name,
			Addr:   sm.Addr.String(),
			Port:   sm.Port,
			Tags:   sm.Tags,
			Status: sm.Status.String(),
		}

		m.members.Delete(sm.Name)

		// Trigger callbacks
		m.mu.RLock()
		callbacks := m.leaveCallbacks
		m.mu.RUnlock()

		for _, fn := range callbacks {
			go fn(member)
		}
	}
}

// handleMemberUpdate handles member update events
func (m *Mesh) handleMemberUpdate(e serf.MemberEvent) {
	for _, sm := range e.Members {
		member := &Member{
			Name:   sm.Name,
			Addr:   sm.Addr.String(),
			Port:   sm.Port,
			Tags:   sm.Tags,
			Status: sm.Status.String(),
		}

		m.members.Store(sm.Name, member)
	}
}

// handleUserEvent handles user events (topology updates)
func (m *Mesh) handleUserEvent(e serf.UserEvent) {
	// Check if this is a topology event
	if e.Name == "topology" {
		m.graph.Update(e.Payload)
		log.Printf("Topology updated from node")
	}
}

// Graph returns the topology graph
func (m *Mesh) Graph() *topology.Graph {
	return m.graph
}
