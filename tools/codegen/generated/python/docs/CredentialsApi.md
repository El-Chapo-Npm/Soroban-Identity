# soroban_identity_client.CredentialsApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**delete_credential**](CredentialsApi.md#delete_credential) | **DELETE** /credentials/{id} | Revoke a credential
[**delete_credential_revocation**](CredentialsApi.md#delete_credential_revocation) | **DELETE** /credentials/{id}/revoke | Revoke a credential via DELETE
[**get_credential**](CredentialsApi.md#get_credential) | **GET** /credentials/{id} | Get credential by ID
[**issue_credential**](CredentialsApi.md#issue_credential) | **POST** /credentials | Issue a new Verifiable Credential
[**issue_credential_alias**](CredentialsApi.md#issue_credential_alias) | **POST** /credentials/issue | Issue a credential (alias for POST /credentials)
[**list_credentials**](CredentialsApi.md#list_credentials) | **GET** /credentials | List credentials (cursor-paginated)
[**revoke_credential**](CredentialsApi.md#revoke_credential) | **POST** /credentials/{id}/revoke | Revoke a credential via POST
[**verify_credential**](CredentialsApi.md#verify_credential) | **POST** /credentials/{id}/verify | Verify credential status


# **delete_credential**
> CredentialRevokeResponse delete_credential(id, if_match=if_match)

Revoke a credential

Marks the credential as revoked in persistent storage and dispatches a `credential.revoked` webhook notification.

### Example

* Api Key Authentication (ApiKeyAuth):
* Bearer Authentication (BearerAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.credential_revoke_response import CredentialRevokeResponse
from soroban_identity_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost:3001
# See configuration.py for a list of all supported configuration parameters.
configuration = soroban_identity_client.Configuration(
    host = "http://localhost:3001"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Configure Bearer authorization: BearerAuth
configuration = soroban_identity_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with soroban_identity_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = soroban_identity_client.CredentialsApi(api_client)
    id = 'cred-kyc-2026-001' # str | Unique identifier of the credential
    if_match = 'if_match_example' # str | Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential's current ETag. (optional)

    try:
        # Revoke a credential
        api_response = api_instance.delete_credential(id, if_match=if_match)
        print("The response of CredentialsApi->delete_credential:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CredentialsApi->delete_credential: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**| Unique identifier of the credential | 
 **if_match** | **str**| Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential&#39;s current ETag. | [optional] 

### Return type

[**CredentialRevokeResponse**](CredentialRevokeResponse.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Credential revoked successfully |  -  |
**401** | Unauthorized - missing or invalid API key |  -  |
**403** | Forbidden - missing credentials:write scope |  -  |
**404** | Credential not found |  -  |
**412** | Precondition Failed - If-Match did not match the credential&#39;s current ETag. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_credential_revocation**
> CredentialRevokeResponse delete_credential_revocation(id)

Revoke a credential via DELETE

Explicit revocation path matching DELETE /credentials/:id/revoke.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.credential_revoke_response import CredentialRevokeResponse
from soroban_identity_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost:3001
# See configuration.py for a list of all supported configuration parameters.
configuration = soroban_identity_client.Configuration(
    host = "http://localhost:3001"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with soroban_identity_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = soroban_identity_client.CredentialsApi(api_client)
    id = 'id_example' # str | 

    try:
        # Revoke a credential via DELETE
        api_response = api_instance.delete_credential_revocation(id)
        print("The response of CredentialsApi->delete_credential_revocation:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CredentialsApi->delete_credential_revocation: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

### Return type

[**CredentialRevokeResponse**](CredentialRevokeResponse.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Credential revoked successfully |  -  |
**401** | Unauthorized - missing or invalid API key |  -  |
**403** | Forbidden - missing credentials:write scope |  -  |
**404** | Credential not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_credential**
> Credential get_credential(id, fields=fields, if_none_match=if_none_match)

Get credential by ID

Retrieves the full record of an existing credential.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.credential import Credential
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
    api_instance = soroban_identity_client.CredentialsApi(api_client)
    id = 'cred-kyc-2026-001' # str | Unique identifier of the credential
    fields = 'fields_example' # str | Comma-separated list of fields to include in the response, e.g. 'id,claims.tier'. Supports dotted paths into nested objects. (optional)
    if_none_match = 'if_none_match_example' # str | Conditional GET. When it matches the current strong ETag, the server returns 304 with no body. (optional)

    try:
        # Get credential by ID
        api_response = api_instance.get_credential(id, fields=fields, if_none_match=if_none_match)
        print("The response of CredentialsApi->get_credential:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CredentialsApi->get_credential: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**| Unique identifier of the credential | 
 **fields** | **str**| Comma-separated list of fields to include in the response, e.g. &#39;id,claims.tier&#39;. Supports dotted paths into nested objects. | [optional] 
 **if_none_match** | **str**| Conditional GET. When it matches the current strong ETag, the server returns 304 with no body. | [optional] 

### Return type

[**Credential**](Credential.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Credential found |  * ETag - Strong entity tag for the canonical credential state (computed the same way regardless of any &#x60;fields&#x60; filtering). Reuse it in If-Match on a later write. <br>  |
**304** | Not Modified - If-None-Match matched the current ETag. |  -  |
**404** | Credential not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **issue_credential**
> Credential issue_credential(issue_credential_request)

Issue a new Verifiable Credential

Persists a newly issued credential, appends an audit log record, and triggers the `credential.issued` webhook event.

### Example

* Api Key Authentication (ApiKeyAuth):
* Bearer Authentication (BearerAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.credential import Credential
from soroban_identity_client.models.issue_credential_request import IssueCredentialRequest
from soroban_identity_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost:3001
# See configuration.py for a list of all supported configuration parameters.
configuration = soroban_identity_client.Configuration(
    host = "http://localhost:3001"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Configure Bearer authorization: BearerAuth
configuration = soroban_identity_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with soroban_identity_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = soroban_identity_client.CredentialsApi(api_client)
    issue_credential_request = {"id":"cred-kyc-2026-001","subject":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF","issuer":"GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF","expiresAt":1893456000,"schema":"https://schema.org/KYCCredential","claims":{"tier":"tier_3","country":"US","verified":true}} # IssueCredentialRequest | 

    try:
        # Issue a new Verifiable Credential
        api_response = api_instance.issue_credential(issue_credential_request)
        print("The response of CredentialsApi->issue_credential:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CredentialsApi->issue_credential: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **issue_credential_request** | [**IssueCredentialRequest**](IssueCredentialRequest.md)|  | 

### Return type

[**Credential**](Credential.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Credential successfully issued and persisted |  -  |
**400** | Missing required fields or invalid body format |  -  |
**401** | Missing or invalid API key authentication token |  -  |
**403** | API key lacks required scope (&#39;credentials:write&#39;) |  -  |
**409** | Credential with the given ID already exists |  -  |
**413** | Request body exceeds maximum payload size limit |  -  |
**415** | Unsupported Media Type (must be application/json) |  -  |
**500** | Internal server or storage failure |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **issue_credential_alias**
> Credential issue_credential_alias(issue_credential_request)

Issue a credential (alias for POST /credentials)

Alias route for credential issuance.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.credential import Credential
from soroban_identity_client.models.issue_credential_request import IssueCredentialRequest
from soroban_identity_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost:3001
# See configuration.py for a list of all supported configuration parameters.
configuration = soroban_identity_client.Configuration(
    host = "http://localhost:3001"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with soroban_identity_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = soroban_identity_client.CredentialsApi(api_client)
    issue_credential_request = {"id":"cred-kyc-2026-001","subject":"GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF","issuer":"GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBWHF","expiresAt":1893456000,"schema":"https://schema.org/KYCCredential","claims":{"tier":"tier_3","country":"US","verified":true}} # IssueCredentialRequest | 

    try:
        # Issue a credential (alias for POST /credentials)
        api_response = api_instance.issue_credential_alias(issue_credential_request)
        print("The response of CredentialsApi->issue_credential_alias:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CredentialsApi->issue_credential_alias: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **issue_credential_request** | [**IssueCredentialRequest**](IssueCredentialRequest.md)|  | 

### Return type

[**Credential**](Credential.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Credential successfully issued and persisted |  -  |
**400** | Missing required fields or invalid body format |  -  |
**401** | Missing or invalid API key authentication token |  -  |
**403** | API key lacks required scope (&#39;credentials:write&#39;) |  -  |
**409** | Credential with the given ID already exists |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_credentials**
> PaginatedCredentials list_credentials(limit=limit, cursor=cursor, direction=direction, fields=fields)

List credentials (cursor-paginated)

Retrieves a cursor-paginated list of credentials. Cursors are opaque tokens returned as nextCursor/previousCursor; pass one back as `cursor` (with `direction=next` or `direction=prev`) to continue paging. The response also carries a weak ETag; a matching If-None-Match returns 304.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.paginated_credentials import PaginatedCredentials
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
    api_instance = soroban_identity_client.CredentialsApi(api_client)
    limit = 50 # int | Number of records to return (max 200) (optional) (default to 50)
    cursor = 'cursor_example' # str | Opaque pagination cursor from a previous response's nextCursor/previousCursor (optional)
    direction = 'next' # str | Direction to page in relative to cursor. 'prev' walks backward through results in the same forward order. (optional) (default to 'next')
    fields = 'fields_example' # str | Comma-separated list of fields to include in each returned credential, e.g. 'id,subject,claims.tier'. Omit to receive the full object. (optional)

    try:
        # List credentials (cursor-paginated)
        api_response = api_instance.list_credentials(limit=limit, cursor=cursor, direction=direction, fields=fields)
        print("The response of CredentialsApi->list_credentials:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CredentialsApi->list_credentials: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | **int**| Number of records to return (max 200) | [optional] [default to 50]
 **cursor** | **str**| Opaque pagination cursor from a previous response&#39;s nextCursor/previousCursor | [optional] 
 **direction** | **str**| Direction to page in relative to cursor. &#39;prev&#39; walks backward through results in the same forward order. | [optional] [default to &#39;next&#39;]
 **fields** | **str**| Comma-separated list of fields to include in each returned credential, e.g. &#39;id,subject,claims.tier&#39;. Omit to receive the full object. | [optional] 

### Return type

[**PaginatedCredentials**](PaginatedCredentials.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of credentials |  * ETag - Strong entity tag for the canonical credential state (computed the same way regardless of any &#x60;fields&#x60; filtering). Reuse it in If-Match on a later write. <br>  |
**304** | Not Modified - the caller&#39;s If-None-Match matches the current page. |  -  |
**400** | Invalid query parameters |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **revoke_credential**
> CredentialRevokeResponse revoke_credential(id)

Revoke a credential via POST

Alias endpoint for credential revocation.

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.credential_revoke_response import CredentialRevokeResponse
from soroban_identity_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost:3001
# See configuration.py for a list of all supported configuration parameters.
configuration = soroban_identity_client.Configuration(
    host = "http://localhost:3001"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Enter a context with an instance of the API client
with soroban_identity_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = soroban_identity_client.CredentialsApi(api_client)
    id = 'id_example' # str | 

    try:
        # Revoke a credential via POST
        api_response = api_instance.revoke_credential(id)
        print("The response of CredentialsApi->revoke_credential:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CredentialsApi->revoke_credential: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

### Return type

[**CredentialRevokeResponse**](CredentialRevokeResponse.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Credential revoked successfully |  -  |
**401** | Unauthorized - missing or invalid API key |  -  |
**403** | Forbidden - missing credentials:write scope |  -  |
**404** | Credential not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **verify_credential**
> CredentialVerifyResponse verify_credential(id)

Verify credential status

Verifies that the credential exists, is not revoked, and has not expired. Returns the complete credential object when verified.

### Example

* Api Key Authentication (ApiKeyAuth):
* Bearer Authentication (BearerAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.credential_verify_response import CredentialVerifyResponse
from soroban_identity_client.rest import ApiException
from pprint import pprint

# Defining the host is optional and defaults to http://localhost:3001
# See configuration.py for a list of all supported configuration parameters.
configuration = soroban_identity_client.Configuration(
    host = "http://localhost:3001"
)

# The client must configure the authentication and authorization parameters
# in accordance with the API server security policy.
# Examples for each auth method are provided below, use the example that
# satisfies your auth use case.

# Configure API key authorization: ApiKeyAuth
configuration.api_key['ApiKeyAuth'] = os.environ["API_KEY"]

# Uncomment below to setup prefix (e.g. Bearer) for API key, if needed
# configuration.api_key_prefix['ApiKeyAuth'] = 'Bearer'

# Configure Bearer authorization: BearerAuth
configuration = soroban_identity_client.Configuration(
    access_token = os.environ["BEARER_TOKEN"]
)

# Enter a context with an instance of the API client
with soroban_identity_client.ApiClient(configuration) as api_client:
    # Create an instance of the API class
    api_instance = soroban_identity_client.CredentialsApi(api_client)
    id = 'id_example' # str | Identifier of the credential to verify

    try:
        # Verify credential status
        api_response = api_instance.verify_credential(id)
        print("The response of CredentialsApi->verify_credential:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling CredentialsApi->verify_credential: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**| Identifier of the credential to verify | 

### Return type

[**CredentialVerifyResponse**](CredentialVerifyResponse.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Verification evaluation result |  -  |
**401** | Unauthorized |  -  |
**403** | Forbidden - missing credentials:read scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

