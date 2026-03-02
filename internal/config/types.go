package config

// Config represents the root Lattice configuration
type Config struct {
	Server *ServerConfig `hcl:"server,block"`
}

// ServerConfig represents the server block
type ServerConfig struct {
	Listen string `hcl:"listen"`
	UI     string `hcl:"ui"`
}
