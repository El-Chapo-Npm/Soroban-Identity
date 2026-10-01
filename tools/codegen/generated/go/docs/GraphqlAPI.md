# \GraphqlAPI

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**GraphqlGet**](GraphqlAPI.md#GraphqlGet) | **Get** /graphql | GraphQL Playground / GET Query
[**GraphqlPost**](GraphqlAPI.md#GraphqlPost) | **Post** /graphql | Execute GraphQL query or mutation



## GraphqlGet

> GraphqlGet(ctx).Execute()

GraphQL Playground / GET Query



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
	r, err := apiClient.GraphqlAPI.GraphqlGet(context.Background()).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GraphqlAPI.GraphqlGet``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
}
```

### Path Parameters

This endpoint does not need any parameter.

### Other Parameters

Other parameters are passed through a pointer to a apiGraphqlGetRequest struct via the builder pattern


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


## GraphqlPost

> GraphqlPost200Response GraphqlPost(ctx).GraphqlPostRequest(graphqlPostRequest).Execute()

Execute GraphQL query or mutation



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
	graphqlPostRequest := *openapiclient.NewGraphqlPostRequest("Query_example") // GraphqlPostRequest | 

	configuration := openapiclient.NewConfiguration()
	apiClient := openapiclient.NewAPIClient(configuration)
	resp, r, err := apiClient.GraphqlAPI.GraphqlPost(context.Background()).GraphqlPostRequest(graphqlPostRequest).Execute()
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error when calling `GraphqlAPI.GraphqlPost``: %v\n", err)
		fmt.Fprintf(os.Stderr, "Full HTTP response: %v\n", r)
	}
	// response from `GraphqlPost`: GraphqlPost200Response
	fmt.Fprintf(os.Stdout, "Response from `GraphqlAPI.GraphqlPost`: %v\n", resp)
}
```

### Path Parameters



### Other Parameters

Other parameters are passed through a pointer to a apiGraphqlPostRequest struct via the builder pattern


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **graphqlPostRequest** | [**GraphqlPostRequest**](GraphqlPostRequest.md) |  | 

### Return type

[**GraphqlPost200Response**](GraphqlPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

- **Content-Type**: application/json
- **Accept**: application/json

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints)
[[Back to Model list]](../README.md#documentation-for-models)
[[Back to README]](../README.md)

