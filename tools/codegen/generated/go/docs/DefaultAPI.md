# \DefaultAPI

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**CreateApiKey**](DefaultAPI.md#CreateApiKey) | **Post** /admin/api-keys | Issue a new API key
[**DeleteApiKey**](DefaultAPI.md#DeleteApiKey) | **Delete** /admin/api-keys/{id} | Revoke an API key
[**ExecuteBatch**](DefaultAPI.md#ExecuteBatch) | **Post** /batch | Execute multiple credential operations in one request (#749)
[**GetApiKey**](DefaultAPI.md#GetApiKey) | **Get** /admin/api-keys/{id} | Get API key metadata
[**GetQuota**](DefaultAPI.md#GetQuota) | **Get** /quota | Get current API quota usage (#748)
[**ListApiKeys**](DefaultAPI.md#ListApiKeys) | **Get** /admin/api-keys | List API keys
[**PollEvents**](DefaultAPI.md#PollEvents) | **Get** /events/poll | Long-poll for contract events (#750)
[**RotateApiKey**](DefaultAPI.md#RotateApiKey) | **Post** /admin/api-keys/{id}/rotate | Rotate an API key
[**VerifyCredentialsBatch**](DefaultAPI.md#VerifyCredentialsBatch) | **Post** /credentials/verify/batch | Verify multiple credentials in a single batch request



## CreateApiKey

> CreateApiKey(ctx).Execute()

Issue a new API key



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.DefaultAPI.CreateApiKey(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DefaultAPI.CreateApiKey``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiCreateApiKeyRequest struct via the builder pattern


### Return type

 (empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## DeleteApiKey

> DeleteApiKey(ctx, id).Execute()

Revoke an API key

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
	r, err := apiClient.DefaultAPI.DeleteApiKey(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DefaultAPI.DeleteApiKey``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiDeleteApiKeyRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

 (empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ExecuteBatch

> ExecuteBatch200Response ExecuteBatch(ctx).ExecuteBatchRequest(executeBatchRequest).Execute()

Execute multiple credential operations in one request (#749)



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
	executeBatchRequest := *openapiclient.NewExecuteBatchRequest([]openapiclient.ExecuteBatchRequestOperationsInner{*openapiclient.NewExecuteBatchRequestOperationsInner("Type_example", map[string]interface{}(123))}) // ExecuteBatchRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.DefaultAPI.ExecuteBatch(context.Background()).ExecuteBatchRequest(executeBatchRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DefaultAPI.ExecuteBatch``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `ExecuteBatch`: ExecuteBatch200Response
	fmt.Fprintf(os.Stdout, "Response from `DefaultAPI.ExecuteBatch`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiExecuteBatchRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **executeBatchRequest** | [**ExecuteBatchRequest**](ExecuteBatchRequest.md) |  | 

### Return type

[**ExecuteBatch200Response**](ExecuteBatch200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetApiKey

> GetApiKey(ctx, id).Execute()

Get API key metadata

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
	r, err := apiClient.DefaultAPI.GetApiKey(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DefaultAPI.GetApiKey``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiGetApiKeyRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

 (empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## GetQuota

> GetQuota200Response GetQuota(ctx).Execute()

Get current API quota usage (#748)



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.DefaultAPI.GetQuota(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DefaultAPI.GetQuota``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GetQuota`: GetQuota200Response
	fmt.Fprintf(os.Stdout, "Response from `DefaultAPI.GetQuota`: %v\n", resp)
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiGetQuotaRequest struct via the builder pattern


### Return type

[**GetQuota200Response**](GetQuota200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## ListApiKeys

> ListApiKeys(ctx).Execute()

List API keys



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

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.DefaultAPI.ListApiKeys(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DefaultAPI.ListApiKeys``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiListApiKeysRequest struct via the builder pattern


### Return type

 (empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## PollEvents

> PollEvents200Response PollEvents(ctx).ContractId(contractId).Topic(topic).Timeout(timeout).LastEventID(lastEventID).Execute()

Long-poll for contract events (#750)



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
	contractId := "contractId_example" // string | Filter to events from one contract. (optional)
	topic := "topic_example" // string | Comma-separated topic filter, positional (e.g. IDENTITY,updated). (optional)
	timeout := int32(56) // int32 | Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000). (optional)
	lastEventID := "lastEventID_example" // string | Ledger cursor to resume from; also accepted as a `lastEventId` or `since` query param. (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.DefaultAPI.PollEvents(context.Background()).ContractId(contractId).Topic(topic).Timeout(timeout).LastEventID(lastEventID).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DefaultAPI.PollEvents``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `PollEvents`: PollEvents200Response
	fmt.Fprintf(os.Stdout, "Response from `DefaultAPI.PollEvents`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiPollEventsRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **contractId** | **string** | Filter to events from one contract. | 
 **topic** | **string** | Comma-separated topic filter, positional (e.g. IDENTITY,updated). | 
 **timeout** | **int32** | Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000). | 
 **lastEventID** | **string** | Ledger cursor to resume from; also accepted as a &#x60;lastEventId&#x60; or &#x60;since&#x60; query param. | 

### Return type

[**PollEvents200Response**](PollEvents200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## RotateApiKey

> RotateApiKey(ctx, id).Execute()

Rotate an API key

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
	r, err := apiClient.DefaultAPI.RotateApiKey(context.Background(), id).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DefaultAPI.RotateApiKey``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
**ctx** | **context.Context** | context for authentication, logging, cancellation, deadlines, tracing, etc.
**id** | **string** |  | 

### Other Parameters

Other parameters are passed through a pointer to a apiRotateApiKeyRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------


### Return type

 (empty response body)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: Not defined

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## VerifyCredentialsBatch

> VerifyCredentialsBatch200Response VerifyCredentialsBatch(ctx).VerifyCredentialsBatchRequest(verifyCredentialsBatchRequest).Execute()

Verify multiple credentials in a single batch request



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
	verifyCredentialsBatchRequest := *openapiclient.NewVerifyCredentialsBatchRequest([]string{"Ids_example"}) // VerifyCredentialsBatchRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.DefaultAPI.VerifyCredentialsBatch(context.Background()).VerifyCredentialsBatchRequest(verifyCredentialsBatchRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `DefaultAPI.VerifyCredentialsBatch``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `VerifyCredentialsBatch`: VerifyCredentialsBatch200Response
	fmt.Fprintf(os.Stdout, "Response from `DefaultAPI.VerifyCredentialsBatch`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiVerifyCredentialsBatchRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **verifyCredentialsBatchRequest** | [**VerifyCredentialsBatchRequest**](VerifyCredentialsBatchRequest.md) |  | 

### Return type

[**VerifyCredentialsBatch200Response**](VerifyCredentialsBatch200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

