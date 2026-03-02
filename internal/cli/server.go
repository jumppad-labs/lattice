package cli

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"connectrpc.com/connect"
	"github.com/jumppad-labs/lattice/internal/api"
	"github.com/jumppad-labs/lattice/internal/config"
	"github.com/jumppad-labs/lattice/internal/serf"
	"github.com/jumppad-labs/lattice/pkg/api/observer/v1/observerapiconnect"
	"github.com/spf13/cobra"
	"golang.org/x/net/http2"
	"golang.org/x/net/http2/h2c"
)

var serverCmd = &cobra.Command{
	Use:   "server",
	Short: "Start the Lattice server",
	Long:  `Start the Lattice server with gossip mesh and web UI.`,
	RunE:  runServer,
}

var serverConfigPath string

func init() {
	serverCmd.Flags().StringVarP(&serverConfigPath, "config", "c", "", "path to configuration file (required)")
	serverCmd.MarkFlagRequired("config")
	rootCmd.AddCommand(serverCmd)
}

func runServer(cmd *cobra.Command, args []string) error {
	// Check if config file exists
	if _, err := os.Stat(serverConfigPath); os.IsNotExist(err) {
		return fmt.Errorf("configuration file not found: %s", serverConfigPath)
	}

	// Parse config
	log.Printf("Loading configuration from %s", serverConfigPath)
	cfg, err := config.ParseFile(serverConfigPath)
	if err != nil {
		return fmt.Errorf("failed to parse config: %w", err)
	}

	// Validate config
	if err := config.Validate(cfg); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}

	log.Printf("Starting Lattice server...")
	log.Printf("  Gossip mesh: %s", cfg.Server.Listen)
	log.Printf("  Web UI + API: %s", cfg.Server.UI)

	ctx := context.Background()

	// Parse listen address
	meshConfig, err := parseMeshConfig(cfg.Server.Listen)
	if err != nil {
		return fmt.Errorf("failed to parse mesh listen address: %w", err)
	}

	// Create and start Serf mesh
	mesh, err := serf.NewMesh(meshConfig)
	if err != nil {
		return fmt.Errorf("failed to create mesh: %w", err)
	}

	if err := mesh.Start(ctx); err != nil {
		return fmt.Errorf("failed to start mesh: %w", err)
	}

	log.Printf("Serf mesh started on %s", cfg.Server.Listen)

	// Create Observer API service
	observerSvc := api.NewObserverService(mesh)

	// Create HTTP mux
	mux := http.NewServeMux()

	// Register Connect-RPC API with CORS
	path, handler := observerapiconnect.NewObserverServiceHandler(
		observerSvc,
		connect.WithInterceptors(newCORSInterceptor()),
	)
	mux.Handle(path, handler)

	// Create HTTP server with h2c (HTTP/2 cleartext) support
	server := &http.Server{
		Addr:    cfg.Server.UI,
		Handler: h2c.NewHandler(mux, &http2.Server{}),
	}

	// Start HTTP server in background
	go func() {
		log.Printf("Connect-RPC API started on %s", cfg.Server.UI)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("HTTP server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)

	<-sigCh
	log.Println("Shutdown signal received, stopping server...")

	// Create a timeout context for graceful shutdown
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Shutdown HTTP server with timeout
	if err := server.Shutdown(shutdownCtx); err != nil {
		log.Printf("HTTP server shutdown error: %v", err)
	}

	// Stop Serf mesh
	if err := mesh.Stop(); err != nil {
		log.Printf("Mesh shutdown error: %v", err)
	}

	log.Println("Server stopped successfully")

	return nil
}

// parseMeshConfig parses the mesh listen address
func parseMeshConfig(listen string) (serf.MeshConfig, error) {
	// For simplicity, parse host:port
	// TODO: Could enhance this to support more complex configurations
	return serf.MeshConfig{
		NodeName: "lattice",
		BindAddr: "0.0.0.0",
		BindPort: 7946, // Default port, could parse from listen address
	}, nil
}

// newCORSInterceptor creates a CORS interceptor for browser requests
func newCORSInterceptor() connect.UnaryInterceptorFunc {
	interceptor := func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			return next(ctx, req)
		}
	}
	return interceptor
}
