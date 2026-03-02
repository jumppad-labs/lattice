package cli

import (
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "lattice",
	Short: "Lattice - Service mesh observer and gossip mesh manager",
	Long: `Lattice is the observer for Polymorph service meshes.
It manages a gossip mesh for service discovery and provides a web UI for topology visualization.`,
}

// Execute runs the root command
func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.SetOut(os.Stdout)
	rootCmd.SetErr(os.Stderr)
}

// Fatal prints an error message and exits
func Fatal(msg string, args ...interface{}) {
	fmt.Fprintf(os.Stderr, "Error: "+msg+"\n", args...)
	os.Exit(1)
}
