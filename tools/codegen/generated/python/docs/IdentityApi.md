# soroban_identity_client.IdentityApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**resolve_did**](IdentityApi.md#resolve_did) | **GET** /1.0/identifiers/{did} | Resolve a DID document


# **resolve_did**
> ResolveDid200Response resolve_did(did)

Resolve a DID document

W3C DID Resolution endpoint for did:stellar identifiers.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.resolve_did200_response import ResolveDid200Response
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
    api_instance = soroban_identity_client.IdentityApi(api_client)
    did = 'did:stellar:GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF' # str | 

    try:
        # Resolve a DID document
        api_response = api_instance.resolve_did(did)
        print("The response of IdentityApi->resolve_did:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling IdentityApi->resolve_did: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **did** | **str**|  | 

### Return type

[**ResolveDid200Response**](ResolveDid200Response.md)

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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

