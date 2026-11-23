# \OauthAPI

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**OauthAuthorize**](OauthAPI.md#OauthAuthorize) | **Get** /oauth/authorize | Authorization endpoint (authorization code grant)
[**OauthIntrospect**](OauthAPI.md#OauthIntrospect) | **Post** /oauth/introspect | Token introspection (RFC 7662)
[**OauthRevoke**](OauthAPI.md#OauthRevoke) | **Post** /oauth/revoke | Token revocation (RFC 7009)
[**OauthToken**](OauthAPI.md#OauthToken) | **Post** /oauth/token | Token endpoint
[**RegisterOauthClient**](OauthAPI.md#RegisterOauthClient) | **Post** /oauth/clients | Register an OAuth 2.0 client



## OauthAuthorize

> OauthAuthorize(ctx).ResponseType(responseType).ClientId(clientId).RedirectUri(redirectUri).Scope(scope).State(state).Execute()

Authorization endpoint (authorization code grant)



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
	responseType := "responseType_example" // string | 
	clientId := "clientId_example" // string | 
	redirectUri := "redirectUri_example" // string | 
	scope := "scope_example" // string | Space-delimited scopes. Defaults to the client's full registered scope set. (optional)
	state := "state_example" // string | Opaque value echoed back unchanged, to protect against CSRF. (optional)

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	r, err := apiClient.OauthAPI.OauthAuthorize(context.Background()).ResponseType(responseType).ClientId(clientId).RedirectUri(redirectUri).Scope(scope).State(state).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OauthAPI.OauthAuthorize``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiOauthAuthorizeRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **responseType** | **string** |  | 
 **clientId** | **string** |  | 
 **redirectUri** | **string** |  | 
 **scope** | **string** | Space-delimited scopes. Defaults to the client&#39;s full registered scope set. | 
 **state** | **string** | Opaque value echoed back unchanged, to protect against CSRF. | 

### Return type

 (empty response body)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: Not defined
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## OauthIntrospect

> OauthIntrospect200Response OauthIntrospect(ctx).OauthIntrospectRequest(oauthIntrospectRequest).Execute()

Token introspection (RFC 7662)



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
	oauthIntrospectRequest := *openapiclient.NewOauthIntrospectRequest("Token_example") // OauthIntrospectRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.OauthAPI.OauthIntrospect(context.Background()).OauthIntrospectRequest(oauthIntrospectRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OauthAPI.OauthIntrospect``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `OauthIntrospect`: OauthIntrospect200Response
	fmt.Fprintf(os.Stdout, "Response from `OauthAPI.OauthIntrospect`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiOauthIntrospectRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **oauthIntrospectRequest** | [**OauthIntrospectRequest**](OauthIntrospectRequest.md) |  | 

### Return type

[**OauthIntrospect200Response**](OauthIntrospect200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## OauthRevoke

> OauthRevoke200Response OauthRevoke(ctx).OauthIntrospectRequest(oauthIntrospectRequest).Execute()

Token revocation (RFC 7009)



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
	oauthIntrospectRequest := *openapiclient.NewOauthIntrospectRequest("Token_example") // OauthIntrospectRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.OauthAPI.OauthRevoke(context.Background()).OauthIntrospectRequest(oauthIntrospectRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OauthAPI.OauthRevoke``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `OauthRevoke`: OauthRevoke200Response
	fmt.Fprintf(os.Stdout, "Response from `OauthAPI.OauthRevoke`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiOauthRevokeRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **oauthIntrospectRequest** | [**OauthIntrospectRequest**](OauthIntrospectRequest.md) |  | 

### Return type

[**OauthRevoke200Response**](OauthRevoke200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## OauthToken

> OauthToken200Response OauthToken(ctx).OauthTokenRequest(oauthTokenRequest).Execute()

Token endpoint



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
	oauthTokenRequest := *openapiclient.NewOauthTokenRequest("GrantType_example", "ClientId_example", "ClientSecret_example") // OauthTokenRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.OauthAPI.OauthToken(context.Background()).OauthTokenRequest(oauthTokenRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OauthAPI.OauthToken``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `OauthToken`: OauthToken200Response
	fmt.Fprintf(os.Stdout, "Response from `OauthAPI.OauthToken`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiOauthTokenRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **oauthTokenRequest** | [**OauthTokenRequest**](OauthTokenRequest.md) |  | 

### Return type

[**OauthToken200Response**](OauthToken200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)


## RegisterOauthClient

> RegisterOauthClient201Response RegisterOauthClient(ctx).RegisterOauthClientRequest(registerOauthClientRequest).Execute()

Register an OAuth 2.0 client



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
	registerOauthClientRequest := *openapiclient.NewRegisterOauthClientRequest([]string{"RedirectUris_example"}) // RegisterOauthClientRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.OauthAPI.RegisterOauthClient(context.Background()).RegisterOauthClientRequest(registerOauthClientRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `OauthAPI.RegisterOauthClient``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `RegisterOauthClient`: RegisterOauthClient201Response
	fmt.Fprintf(os.Stdout, "Response from `OauthAPI.RegisterOauthClient`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiRegisterOauthClientRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **registerOauthClientRequest** | [**RegisterOauthClientRequest**](RegisterOauthClientRequest.md) |  | 

### Return type

[**RegisterOauthClient201Response**](RegisterOauthClient201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

