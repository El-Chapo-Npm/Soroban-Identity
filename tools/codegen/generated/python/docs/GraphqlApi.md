# soroban_identity_client.GraphqlApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**graphql_get**](GraphqlApi.md#graphql_get) | **GET** /graphql | GraphQL Playground / GET Query
[**graphql_post**](GraphqlApi.md#graphql_post) | **POST** /graphql | Execute GraphQL query or mutation


# **graphql_get**
> graphql_get()

GraphQL Playground / GET Query

Renders interactive GraphiQL playground in browser or executes query via query string.

### Example


```python
import soroban_identity_client
from soroban_identity_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost:3001
# See configuration.py for a list of all supported configuration parameters.
configuration = soroban_identity_client.Configuration(
    host = "http://localhost:3001"
)


# Enter a context with an instance of the API client
with soroban_identity_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = soroban_identity_client.GraphqlApi(api_client)

    try:
        # GraphQL Playground / GET Query
        api_instance.graphql_get()
    except Exception as e:
        print("Exception when calling GraphqlApi->graphql_get: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

void (empty response body)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Playground HTML or JSON query response |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **graphql_post**
> GraphqlPost200Response graphql_post(graphql_post_request)

Execute GraphQL query or mutation

Executes GraphQL operation with DataLoader caching and batching.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.graphql_post200_response import GraphqlPost200Response
from soroban_identity_client.models.graphql_post_request import GraphqlPostRequest
from soroban_identity_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost:3001
# See configuration.py for a list of all supported configuration parameters.
configuration = soroban_identity_client.Configuration(
    host = "http://localhost:3001"
)


# Enter a context with an instance of the API client
with soroban_identity_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = soroban_identity_client.GraphqlApi(api_client)
    graphql_post_request = soroban_identity_client.GraphqlPostRequest() # GraphqlPostRequest | 

    try:
        # Execute GraphQL query or mutation
        api_response = api_instance.graphql_post(graphql_post_request)
        print("The response of GraphqlApi->graphql_post:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling GraphqlApi->graphql_post: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **graphql_post_request** | [**GraphqlPostRequest**](GraphqlPostRequest.md)|  | 

### Return type

[**GraphqlPost200Response**](GraphqlPost200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | GraphQL Execution Result |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

