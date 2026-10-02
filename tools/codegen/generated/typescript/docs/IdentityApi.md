# .IdentityApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**resolveDid**](IdentityApi.md#resolveDid) | **GET** /1.0/identifiers/{did} | Resolve a DID document


# **resolveDid**
> ResolveDid200Response resolveDid()

W3C DID Resolution endpoint for did:stellar identifiers.

### Example


```typescript
import { createConfiguration, IdentityApi } from '';
import type { IdentityApiResolveDidRequest } from '';

const configuration = createConfiguration();
const apiInstance = new IdentityApi(configuration);

const request: IdentityApiResolveDidRequest = {
  
  did: "did:stellar:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
};

const data = await apiInstance.resolveDid(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **did** | [**string**] |  | defaults to undefined


### Return type

**ResolveDid200Response**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | DID Resolution response |  -  |
**400** | Invalid DID format |  -  |
**502** | Upstream RPC failure |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)


