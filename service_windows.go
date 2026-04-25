//go:build windows

package main

import (
	"context"
	"log"
	"time"

	"golang.org/x/sys/windows/svc"
)

const serviceName = "VCollabWebRDP"

type vCollabService struct{}

func (s *vCollabService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (ssec bool, errno uint32) {
	const acceptedCmds = svc.AcceptStop | svc.AcceptShutdown

	changes <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Run the HTTP server in the background
	errCh := make(chan error, 1)
	go func() {
		errCh <- runServer(ctx)
	}()

	changes <- svc.Status{State: svc.Running, Accepts: acceptedCmds}

	for {
		select {
		case err := <-errCh:
			if err != nil {
				log.Printf("Server error: %v", err)
				changes <- svc.Status{State: svc.StopPending}
				return false, 1
			}
			changes <- svc.Status{State: svc.StopPending}
			return false, 0

		case c := <-r:
			switch c.Cmd {
			case svc.Interrogate:
				changes <- c.CurrentStatus
				time.Sleep(100 * time.Millisecond)
				changes <- c.CurrentStatus

			case svc.Stop, svc.Shutdown:
				log.Println("Service stop/shutdown requested")
				changes <- svc.Status{State: svc.StopPending}
				cancel()
				// Wait for server to finish
				<-errCh
				return false, 0
			}
		}
	}
}

func runService() {
	isService, err := svc.IsWindowsService()
	if err != nil {
		log.Fatalf("Failed to detect service mode: %v", err)
	}

	if isService {
		// Running as a Windows service — hand off to SCM
		log.Println("Running as Windows service")
		if err := svc.Run(serviceName, &vCollabService{}); err != nil {
			log.Fatalf("Service failed: %v", err)
		}
		return
	}

	// Running interactively — just run the server with signal handling
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle Ctrl+C for interactive use
	go func() {
		waitForSignal()
		cancel()
	}()

	if err := runServer(ctx); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
