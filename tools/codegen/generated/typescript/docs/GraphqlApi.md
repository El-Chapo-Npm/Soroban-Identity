# .GraphqlApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**graphqlGet**](GraphqlApi.md#graphqlGet) | **GET** /graphql | GraphQL Playground / GET Query
[**graphqlPost**](GraphqlApi.md#graphqlPost) | **POST** /graphql | Execute GraphQL query or mutation


# **graphqlGet**
> void graphqlGet()

Renders interactive GraphiQL playground in browser or executes query via query string.

### Example


```typescript
import { createConfiguration, GraphqlApi } from '';

const configuration = createConfiguration();
const apiInstance = new GraphqlApi(configuration);

const request = {};

const data = await apiInstance.graphqlGet(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters
This endpoint does not need any parameter.


### Return type

**void**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: Not defined


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Playground HTML or JSON query response |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **graphqlPost**
> GraphqlPost200Response graphqlPost(graphqlPostRequest)

Executes GraphQL operation with DataLoader caching and batching.

### Example


```typescript
import { createConfiguration, GraphqlApi } from '';
import type { GraphqlApiGraphqlPostRequest } from '';

const configuration = createConfiguration();
const apiInstance = new GraphqlApi(configuration);

const request: GraphqlApiGraphqlPostRequest = {
  
  graphqlPostRequest: {
    query: "query_example",
    variables: {},
    operationName: "operationName_example",
  },
};

const data = await apiInstance.graphqlPost(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **graphqlPostRequest** | **GraphqlPostRequest**|  |


### Return type

**GraphqlPost200Response**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | GraphQL Execution Result |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)


