package topology

import (
	"encoding/json"
	"log"
	"sync"
)

// TopologyEvent is received from Polymorph nodes via Serf user events
type TopologyEvent struct {
	Node      string   `json:"n"`  // Node name
	Neighbors []string `json:"nb"` // Direct neighbors
}

// Graph represents the mesh connectivity graph
type Graph struct {
	mu    sync.RWMutex
	edges map[string][]string // node -> neighbors
}

// NewGraph creates a new empty graph
func NewGraph() *Graph {
	return &Graph{
		edges: make(map[string][]string),
	}
}

// Update updates the graph with a topology event
func (g *Graph) Update(eventData []byte) {
	var event TopologyEvent
	if err := json.Unmarshal(eventData, &event); err != nil {
		log.Printf("Failed to parse topology event: %v", err)
		return
	}

	g.mu.Lock()
	defer g.mu.Unlock()

	// Store direct edges: event.Node -> neighbors
	g.edges[event.Node] = event.Neighbors

	// Also add reverse edges to make graph bidirectional
	// If Node A can see Node B, then B can likely reach A too
	for _, neighbor := range event.Neighbors {
		// Get existing neighbors for this neighbor node
		existing := g.edges[neighbor]

		// Add event.Node if not already in the list
		found := false
		for _, n := range existing {
			if n == event.Node {
				found = true
				break
			}
		}
		if !found {
			g.edges[neighbor] = append(existing, event.Node)
		}
	}

	log.Printf("Topology updated: %s -> %v", event.Node, event.Neighbors)
}

// FindPath finds the shortest path from source to target using BFS
func (g *Graph) FindPath(from, to string) []string {
	g.mu.RLock()
	defer g.mu.RUnlock()

	if from == to {
		return []string{from}
	}

	// BFS to find shortest path
	queue := [][]string{{from}}
	visited := map[string]bool{from: true}

	for len(queue) > 0 {
		path := queue[0]
		queue = queue[1:]
		node := path[len(path)-1]

		// Check neighbors
		for _, neighbor := range g.edges[node] {
			if neighbor == to {
				// Found target!
				return append(path, neighbor)
			}

			if !visited[neighbor] {
				visited[neighbor] = true
				newPath := make([]string, len(path)+1)
				copy(newPath, path)
				newPath[len(path)] = neighbor
				queue = append(queue, newPath)
			}
		}
	}

	// No path found
	return nil
}

// GetNeighbors returns the neighbors of a node
func (g *Graph) GetNeighbors(node string) []string {
	g.mu.RLock()
	defer g.mu.RUnlock()

	neighbors := g.edges[node]
	result := make([]string, len(neighbors))
	copy(result, neighbors)
	return result
}
