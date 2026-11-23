"""Python client example for the Soroban Identity API.

Install:  pip install soroban-identity-python
Run:      python examples/python/basic.py

Requires a running Soroban Identity server on http://localhost:7400
See tools/codegen/README.md for server instructions.
"""
from soroban_identity_client import ApiClient, Configuration, CredentialsApi, SystemApi
from soroban_identity_client.models import IssueCredentialRequest


def main() -> None:
    config = Configuration(host="http://localhost:7400")
    client = ApiClient(configuration=config)

    system = SystemApi(client)
    info = system.get_server_info()
    print(f"Server: {info.version} | api {info.api_version}")

    credentials = CredentialsApi(client)
    issued = credentials.issue_credential(
        IssueCredentialRequest(
            id="cred-doc11-001",
            subject="GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
            issuer="GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF",
            expires_at=1893456000,
            claims={"tier": "silver"},
        )
    )
    print("Issued:", issued.id)

    page = credentials.list_credentials(limit=10, direction="next")
    print("Total credentials:", len(page.items or []))

    result = credentials.verify_credential(issued.id)
    print("Verified:", result.verified)


if __name__ == "__main__":
    main()