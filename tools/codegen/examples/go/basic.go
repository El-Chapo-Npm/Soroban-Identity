// Go client example for the Soroban Identity API.
//
// Install:  go get github.com/El-Chapo-Npm/Soroban-Identity/tools/codegen/generated/go
// Run:      cd tools/codegen/examples/go && go run .
//
// Requires a running Soroban Identity server on http://localhost:7400
// See tools/codegen/README.md for server instructions.
package main

import (
	"context"
	"fmt"
	"log"

	sw "github.com/El-Chapo-Npm/Soroban-Identity/tools/codegen/generated/go"
)

func f32(v float32) *float32 { return &v }

func main() {
	cfg := sw.NewConfiguration()
	cfg.Servers = sw.ServerConfigurations{{URL: "http://localhost:7400"}}
	client := sw.NewAPIClient(cfg)
	ctx := context.Background()

	info, _, err := client.SystemAPI.GetServerInfo(ctx).Execute()
	if err != nil {
		log.Fatalf("getServerInfo: %v", err)
	}
	fmt.Printf("Server: %s | api %s\n", info.GetVersion(), info.GetApiVersion())

	issued, _, err := client.CredentialsAPI.IssueCredential(ctx).
		IssueCredentialRequest(sw.IssueCredentialRequest{
			Id:        "cred-doc11-001",
			Subject:   "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
			Issuer:    "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF",
			ExpiresAt: f32(1893456000),
			Claims:    map[string]interface{}{"tier": "silver"},
		}).
		Execute()
	if err != nil {
		log.Fatalf("issueCredential: %v", err)
	}
	fmt.Println("Issued:", issued.GetId())

	page, _, err := client.CredentialsAPI.ListCredentials(ctx).Limit(10).Execute()
	if err != nil {
		log.Fatalf("listCredentials: %v", err)
	}
	fmt.Println("Total credentials:", len(page.GetItems()))

	status, _, err := client.CredentialsAPI.VerifyCredential(ctx, issued.GetId()).Execute()
	if err != nil {
		log.Fatalf("verifyCredential: %v", err)
	}
	fmt.Println("Verified:", status.GetVerified())
}