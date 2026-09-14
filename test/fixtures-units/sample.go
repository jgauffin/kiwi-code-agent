package main

import "fmt"

type Server struct {
	name string
}

type Handler interface {
	Serve()
}

func (s *Server) Serve() {
	for i := 0; i < 3; i++ {
		fmt.Println(`raw { string`)
	}
	go func() {
		s.name = "x"
	}()
}

func main() {
	cfg := Config{Name: "a"}
	fn := func() {
		_ = cfg
	}
	fn()
	if err := run(); err != nil {
		return
	}
}
