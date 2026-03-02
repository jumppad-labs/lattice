package main

import (
	"os"

	"github.com/jumppad-labs/lattice/internal/cli"
)

func main() {
	if err := cli.Execute(); err != nil {
		os.Exit(1)
	}
}
