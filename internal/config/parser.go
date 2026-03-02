package config

import (
	"fmt"
	"os"

	"github.com/hashicorp/hcl/v2/hclsimple"
)

// ParseFile parses a Lattice configuration file
func ParseFile(path string) (*Config, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var cfg Config
	if err := hclsimple.Decode(path, content, nil, &cfg); err != nil {
		return nil, fmt.Errorf("failed to decode HCL: %w", err)
	}

	return &cfg, nil
}

// Validate validates the configuration
func Validate(cfg *Config) error {
	if cfg.Server == nil {
		return fmt.Errorf("server block is required")
	}

	if cfg.Server.Listen == "" {
		return fmt.Errorf("server.listen is required")
	}

	if cfg.Server.UI == "" {
		return fmt.Errorf("server.ui is required")
	}

	return nil
}
