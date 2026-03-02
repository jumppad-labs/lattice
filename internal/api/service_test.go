package api

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	observerv1 "github.com/jumppad-labs/lattice/pkg/api/observer/v1"
	latticeserf "github.com/jumppad-labs/lattice/internal/serf"
	"github.com/stretchr/testify/require"
)

func TestNewObserverService(t *testing.T) {
	mesh, err := latticeserf.NewMesh(latticeserf.MeshConfig{
		NodeName: "test-lattice",
		BindPort: 0, // Random port
	})
	require.NoError(t, err)

	svc := NewObserverService(mesh)
	require.NotNil(t, svc)
	require.NotNil(t, svc.mesh)
	require.NotNil(t, svc.watchers)
}

func TestObserverService_GetTopology(t *testing.T) {
	mesh, err := latticeserf.NewMesh(latticeserf.MeshConfig{
		NodeName: "test-lattice",
		BindPort: 0,
	})
	require.NoError(t, err)

	ctx := context.Background()
	err = mesh.Start(ctx)
	require.NoError(t, err)
	defer mesh.Stop()

	svc := NewObserverService(mesh)

	req := connect.NewRequest(&observerv1.GetTopologyRequest{})
	resp, err := svc.GetTopology(ctx, req)
	require.NoError(t, err)
	require.NotNil(t, resp)
	require.NotNil(t, resp.Msg.Topology)
	require.NotNil(t, resp.Msg.Topology.Services)
}

func TestObserverService_BuildTopology(t *testing.T) {
	mesh, err := latticeserf.NewMesh(latticeserf.MeshConfig{
		NodeName: "test-lattice",
		BindPort: 0,
		Tags: map[string]string{
			"service_name": "api",
			"service_type": "http",
		},
	})
	require.NoError(t, err)

	ctx := context.Background()
	err = mesh.Start(ctx)
	require.NoError(t, err)
	defer mesh.Stop()

	svc := NewObserverService(mesh)

	// Give mesh time to initialize
	time.Sleep(100 * time.Millisecond)

	topology := svc.buildTopology()
	require.NotNil(t, topology)
	require.Greater(t, topology.Timestamp, int64(0))

	// Should have at least the lattice node with tags
	require.GreaterOrEqual(t, len(topology.Services), 1)
}

func TestMapStatus(t *testing.T) {
	tests := []struct {
		name     string
		status   string
		expected observerv1.ServiceStatus
	}{
		{
			name:     "alive status",
			status:   "alive",
			expected: observerv1.ServiceStatus_SERVICE_STATUS_HEALTHY,
		},
		{
			name:     "leaving status",
			status:   "leaving",
			expected: observerv1.ServiceStatus_SERVICE_STATUS_UNHEALTHY,
		},
		{
			name:     "left status",
			status:   "left",
			expected: observerv1.ServiceStatus_SERVICE_STATUS_UNHEALTHY,
		},
		{
			name:     "failed status",
			status:   "failed",
			expected: observerv1.ServiceStatus_SERVICE_STATUS_UNHEALTHY,
		},
		{
			name:     "unknown status",
			status:   "unknown",
			expected: observerv1.ServiceStatus_SERVICE_STATUS_UNKNOWN,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := mapStatus(tt.status)
			require.Equal(t, tt.expected, result)
		})
	}
}
