# \CredentialsAPI

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**DeleteCredential**](CredentialsAPI.md#DeleteCredential) | **Delete** /credentials/{id} | Revoke a credential
[**DeleteCredentialRevocation**](CredentialsAPI.md#DeleteCredentialRevocation) | **Delete** /credentials/{id}/revoke | Revoke a credential via DELETE
[**GetCredential**](CredentialsAPI.md#GetCredential) | **Get** /credentials/{id} | Get credential by ID
[**IssueCredential**](CredentialsAPI.md#IssueCredential) | **Post** /credentials | Issue a new Verifiable Credential
[**IssueCredentialAlias**](CredentialsAPI.md#IssueCredentialAlias) | **Post** /credentials/issue | Issue a credential (alias for POST /credentials)
[**ListCredentials**](CredentialsAPI.md#ListCredentials) | **Get** /credentials | List credentials (cursor-paginated)
[**RevokeCredential**](CredentialsAPI.md#RevokeCredential) | **Post** /credentials/{id}/revoke | Revoke a credential via POST
[**VerifyCredential**](CredentialsAPI.md#VerifyCredential) | **Post** /credentials/{id}/verify | Verify credential status



## DeleteCredential

> CredentialRevokeResponse DeleteCredential(ctx, id).IfMatch(ifMatch).Execute()

Revoke a credential



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
	id := "cred-kyc-2026-001" // string | Unique identifier of the credential
	ifMatch := "ifMatch_example" // string | Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential's current ETag. (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.CredentialsAPI.DeleteCredential(context.Background(), id).IfMatch(ifMatch).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `CredentialsAPI.DeleteCredential``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DeleteCredential`: CredentialRevokeResponse
	fmt.Fprintf(os.Stdout, "Response from `CredentialsAPI.DeleteCredential`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** | Unique identifier of the credential | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteCredentialRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **ifMatch** | **string** | Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential&#39;s current ETag. | 

### Return type

[**CredentialRevokeResponse**](CredentialRevokeResponse.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## DeleteCredentialRevocation

> CredentialRevokeResponse DeleteCredentialRevocation(ctx, id).Execute()

Revoke a credential via DELETE



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.CredentialsAPI.DeleteCredentialRevocation(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `CredentialsAPI.DeleteCredentialRevocation``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `DeleteCredentialRevocation`: CredentialRevokeResponse
	fmt.Fprintf(os.Stdout, "Response from `CredentialsAPI.DeleteCredentialRevocation`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteCredentialRevocationRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**CredentialRevokeResponse**](CredentialRevokeResponse.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetCredential

> Credential GetCredential(ctx, id).Fields(fields).IfNoneMatch(ifNoneMatch).Execute()

Get credential by ID



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
	id := "cred-kyc-2026-001" // string | Unique identifier of the credential
	fields := "fields_example" // string | Comma-separated list of fields to include in the response, e.g. 'id,claims.tier'. Supports dotted paths into nested objects. (optional)
	ifNoneMatch := "ifNoneMatch_example" // string | Conditional GET. When it matches the current strong ETag, the server returns 304 with no body. (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.CredentialsAPI.GetCredential(context.Background(), id).Fields(fields).IfNoneMatch(ifNoneMatch).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `CredentialsAPI.GetCredential``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetCredential`: Credential
	fmt.Fprintf(os.Stdout, "Response from `CredentialsAPI.GetCredential`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** | Unique identifier of the credential | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetCredentialRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------

 **fields** | **string** | Comma-separated list of fields to include in the response, e.g. &#39;id,claims.tier&#39;. Supports dotted paths into nested objects. | 
 **ifNoneMatch** | **string** | Conditional GET. When it matches the current strong ETag, the server returns 304 with no body. | 

### Return type

[**Credential**](Credential.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## IssueCredential

> Credential IssueCredential(ctx).IssueCredentialRequest(issueCredentialRequest).Execute()

Issue a new Verifiable Credential



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
	issueCredentialRequest := *openapiclient.NewIssueCredentialRequest("Id_example", "Subject_example", "Issuer_example") // IssueCredentialRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.CredentialsAPI.IssueCredential(context.Background()).IssueCredentialRequest(issueCredentialRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `CredentialsAPI.IssueCredential``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `IssueCredential`: Credential
	fmt.Fprintf(os.Stdout, "Response from `CredentialsAPI.IssueCredential`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiIssueCredentialRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **issueCredentialRequest** | [**IssueCredentialRequest**](IssueCredentialRequest.md) |  | 

### Return type

[**Credential**](Credential.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## IssueCredentialAlias

> Credential IssueCredentialAlias(ctx).IssueCredentialRequest(issueCredentialRequest).Execute()

Issue a credential (alias for POST /credentials)



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
	issueCredentialRequest := *openapiclient.NewIssueCredentialRequest("Id_example", "Subject_example", "Issuer_example") // IssueCredentialRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.CredentialsAPI.IssueCredentialAlias(context.Background()).IssueCredentialRequest(issueCredentialRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `CredentialsAPI.IssueCredentialAlias``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `IssueCredentialAlias`: Credential
	fmt.Fprintf(os.Stdout, "Response from `CredentialsAPI.IssueCredentialAlias`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiIssueCredentialAliasRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **issueCredentialRequest** | [**IssueCredentialRequest**](IssueCredentialRequest.md) |  | 

### Return type

[**Credential**](Credential.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListCredentials

> PaginatedCredentials ListCredentials(ctx).Limit(limit).Cursor(cursor).Direction(direction).Fields(fields).Execute()

List credentials (cursor-paginated)



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
	limit := int32(56) // int32 | Number of records to return (max 200) (optional) (default to 50)
	cursor := "cursor_example" // string | Opaque pagination cursor from a previous response's nextCursor/previousCursor (optional)
	direction := "direction_example" // string | Direction to page in relative to cursor. 'prev' walks backward through results in the same forward order. (optional) (default to "next")
	fields := "fields_example" // string | Comma-separated list of fields to include in each returned credential, e.g. 'id,subject,claims.tier'. Omit to receive the full object. (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.CredentialsAPI.ListCredentials(context.Background()).Limit(limit).Cursor(cursor).Direction(direction).Fields(fields).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `CredentialsAPI.ListCredentials``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ListCredentials`: PaginatedCredentials
	fmt.Fprintf(os.Stdout, "Response from `CredentialsAPI.ListCredentials`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiListCredentialsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int32** | Number of records to return (max 200) | [default to 50]
 **cursor** | **string** | Opaque pagination cursor from a previous response&#39;s nextCursor/previousCursor | 
 **direction** | **string** | Direction to page in relative to cursor. &#39;prev&#39; walks backward through results in the same forward order. | [default to &quot;next&quot;]
 **fields** | **string** | Comma-separated list of fields to include in each returned credential, e.g. &#39;id,subject,claims.tier&#39;. Omit to receive the full object. | 

### Return type

[**PaginatedCredentials**](PaginatedCredentials.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## RevokeCredential

> CredentialRevokeResponse RevokeCredential(ctx, id).Execute()

Revoke a credential via POST



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
	id := "id_example" // string | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.CredentialsAPI.RevokeCredential(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `CredentialsAPI.RevokeCredential``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `RevokeCredential`: CredentialRevokeResponse
	fmt.Fprintf(os.Stdout, "Response from `CredentialsAPI.RevokeCredential`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiRevokeCredentialRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**CredentialRevokeResponse**](CredentialRevokeResponse.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## VerifyCredential

> CredentialVerifyResponse VerifyCredential(ctx, id).Execute()

Verify credential status



### Example

```go
package main

import (
	"context"
	"fmt"
	"os"
	openapiclient "github.com/GIT_USER_ID/GIT_REPO_ID"
)

func main() {
	id := "id_example" // string | Identifier of the credential to verify

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.CredentialsAPI.VerifyCredential(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `CredentialsAPI.VerifyCredential``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `VerifyCredential`: CredentialVerifyResponse
	fmt.Fprintf(os.Stdout, "Response from `CredentialsAPI.VerifyCredential`: %v\n", resp)
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** | Identifier of the credential to verify | 

### Other Parameters

Other parameters are passed through a pointer to a apiVerifyCredentialRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

[**CredentialVerifyResponse**](CredentialVerifyResponse.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

