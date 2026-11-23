# .CredentialsApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**deleteCredential**](CredentialsApi.md#deleteCredential) | **DELETE** /credentials/{id} | Revoke a credential
[**deleteCredentialRevocation**](CredentialsApi.md#deleteCredentialRevocation) | **DELETE** /credentials/{id}/revoke | Revoke a credential via DELETE
[**getCredential**](CredentialsApi.md#getCredential) | **GET** /credentials/{id} | Get credential by ID
[**issueCredential**](CredentialsApi.md#issueCredential) | **POST** /credentials | Issue a new Verifiable Credential
[**issueCredentialAlias**](CredentialsApi.md#issueCredentialAlias) | **POST** /credentials/issue | Issue a credential (alias for POST /credentials)
[**listCredentials**](CredentialsApi.md#listCredentials) | **GET** /credentials | List credentials (cursor-paginated)
[**revokeCredential**](CredentialsApi.md#revokeCredential) | **POST** /credentials/{id}/revoke | Revoke a credential via POST
[**verifyCredential**](CredentialsApi.md#verifyCredential) | **POST** /credentials/{id}/verify | Verify credential status


# **deleteCredential**
> CredentialRevokeResponse deleteCredential()

Marks the credential as revoked in persistent storage and dispatches a `credential.revoked` webhook notification.

### Example


```typescript
import { createConfiguration, CredentialsApi } from '';
import type { CredentialsApiDeleteCredentialRequest } from '';

const configuration = createConfiguration();
const apiInstance = new CredentialsApi(configuration);

const request: CredentialsApiDeleteCredentialRequest = {
    // Unique identifier of the credential
  id: "cred-kyc-2026-001",
    // Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential\'s current ETag. (optional)
  ifMatch: "If-Match_example",
};

const data = await apiInstance.deleteCredential(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] | Unique identifier of the credential | defaults to undefined
 **ifMatch** | [**string**] | Optimistic concurrency. When present, the revoke is rejected with 412 unless it matches the credential\&#39;s current ETag. | (optional) defaults to undefined


### Return type

**CredentialRevokeResponse**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth), [BearerAuth](README.md#BearerAuth)

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
**412** | Precondition Failed - If-Match did not match the credential\&#39;s current ETag. |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **deleteCredentialRevocation**
> CredentialRevokeResponse deleteCredentialRevocation()

Explicit revocation path matching DELETE /credentials/:id/revoke.

### Example


```typescript
import { createConfiguration, CredentialsApi } from '';
import type { CredentialsApiDeleteCredentialRevocationRequest } from '';

const configuration = createConfiguration();
const apiInstance = new CredentialsApi(configuration);

const request: CredentialsApiDeleteCredentialRevocationRequest = {
  
  id: "id_example",
};

const data = await apiInstance.deleteCredentialRevocation(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] |  | defaults to undefined


### Return type

**CredentialRevokeResponse**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth)

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

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **getCredential**
> Credential getCredential()

Retrieves the full record of an existing credential.

### Example


```typescript
import { createConfiguration, CredentialsApi } from '';
import type { CredentialsApiGetCredentialRequest } from '';

const configuration = createConfiguration();
const apiInstance = new CredentialsApi(configuration);

const request: CredentialsApiGetCredentialRequest = {
    // Unique identifier of the credential
  id: "cred-kyc-2026-001",
    // Comma-separated list of fields to include in the response, e.g. \'id,claims.tier\'. Supports dotted paths into nested objects. (optional)
  fields: "fields_example",
    // Conditional GET. When it matches the current strong ETag, the server returns 304 with no body. (optional)
  ifNoneMatch: "If-None-Match_example",
};

const data = await apiInstance.getCredential(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] | Unique identifier of the credential | defaults to undefined
 **fields** | [**string**] | Comma-separated list of fields to include in the response, e.g. \&#39;id,claims.tier\&#39;. Supports dotted paths into nested objects. | (optional) defaults to undefined
 **ifNoneMatch** | [**string**] | Conditional GET. When it matches the current strong ETag, the server returns 304 with no body. | (optional) defaults to undefined


### Return type

**Credential**

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

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **issueCredential**
> Credential issueCredential(issueCredentialRequest)

Persists a newly issued credential, appends an audit log record, and triggers the `credential.issued` webhook event.

### Example


```typescript
import { createConfiguration, CredentialsApi } from '';
import type { CredentialsApiIssueCredentialRequest } from '';

const configuration = createConfiguration();
const apiInstance = new CredentialsApi(configuration);

const request: CredentialsApiIssueCredentialRequest = {
  
  issueCredentialRequest: {
    id: "id_example",
    subject: "subject_example",
    issuer: "issuer_example",
    expiresAt: 3.14,
    schema: "schema_example",
    claims: {},
  },
};

const data = await apiInstance.issueCredential(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **issueCredentialRequest** | **IssueCredentialRequest**|  |


### Return type

**Credential**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth), [BearerAuth](README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Credential successfully issued and persisted |  -  |
**400** | Missing required fields or invalid body format |  -  |
**401** | Missing or invalid API key authentication token |  -  |
**403** | API key lacks required scope (\&#39;credentials:write\&#39;) |  -  |
**409** | Credential with the given ID already exists |  -  |
**413** | Request body exceeds maximum payload size limit |  -  |
**415** | Unsupported Media Type (must be application/json) |  -  |
**500** | Internal server or storage failure |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **issueCredentialAlias**
> Credential issueCredentialAlias(issueCredentialRequest)

Alias route for credential issuance.

### Example


```typescript
import { createConfiguration, CredentialsApi } from '';
import type { CredentialsApiIssueCredentialAliasRequest } from '';

const configuration = createConfiguration();
const apiInstance = new CredentialsApi(configuration);

const request: CredentialsApiIssueCredentialAliasRequest = {
  
  issueCredentialRequest: {
    id: "id_example",
    subject: "subject_example",
    issuer: "issuer_example",
    expiresAt: 3.14,
    schema: "schema_example",
    claims: {},
  },
};

const data = await apiInstance.issueCredentialAlias(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **issueCredentialRequest** | **IssueCredentialRequest**|  |


### Return type

**Credential**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Credential successfully issued and persisted |  -  |
**400** | Missing required fields or invalid body format |  -  |
**401** | Missing or invalid API key authentication token |  -  |
**403** | API key lacks required scope (\&#39;credentials:write\&#39;) |  -  |
**409** | Credential with the given ID already exists |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **listCredentials**
> PaginatedCredentials listCredentials()

Retrieves a cursor-paginated list of credentials. Cursors are opaque tokens returned as nextCursor/previousCursor; pass one back as `cursor` (with `direction=next` or `direction=prev`) to continue paging. The response also carries a weak ETag; a matching If-None-Match returns 304.

### Example


```typescript
import { createConfiguration, CredentialsApi } from '';
import type { CredentialsApiListCredentialsRequest } from '';

const configuration = createConfiguration();
const apiInstance = new CredentialsApi(configuration);

const request: CredentialsApiListCredentialsRequest = {
    // Number of records to return (max 200) (optional)
  limit: 50,
    // Opaque pagination cursor from a previous response\'s nextCursor/previousCursor (optional)
  cursor: "cursor_example",
    // Direction to page in relative to cursor. \'prev\' walks backward through results in the same forward order. (optional)
  direction: "next",
    // Comma-separated list of fields to include in each returned credential, e.g. \'id,subject,claims.tier\'. Omit to receive the full object. (optional)
  fields: "fields_example",
};

const data = await apiInstance.listCredentials(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **limit** | [**number**] | Number of records to return (max 200) | (optional) defaults to 50
 **cursor** | [**string**] | Opaque pagination cursor from a previous response\&#39;s nextCursor/previousCursor | (optional) defaults to undefined
 **direction** | [**&#39;next&#39; | &#39;prev&#39;**]**Array<&#39;next&#39; &#124; &#39;prev&#39;>** | Direction to page in relative to cursor. \&#39;prev\&#39; walks backward through results in the same forward order. | (optional) defaults to 'next'
 **fields** | [**string**] | Comma-separated list of fields to include in each returned credential, e.g. \&#39;id,subject,claims.tier\&#39;. Omit to receive the full object. | (optional) defaults to undefined


### Return type

**PaginatedCredentials**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of credentials |  * ETag - Strong entity tag for the canonical credential state (computed the same way regardless of any &#x60;fields&#x60; filtering). Reuse it in If-Match on a later write. <br>  |
**304** | Not Modified - the caller\&#39;s If-None-Match matches the current page. |  -  |
**400** | Invalid query parameters |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **revokeCredential**
> CredentialRevokeResponse revokeCredential()

Alias endpoint for credential revocation.

### Example


```typescript
import { createConfiguration, CredentialsApi } from '';
import type { CredentialsApiRevokeCredentialRequest } from '';

const configuration = createConfiguration();
const apiInstance = new CredentialsApi(configuration);

const request: CredentialsApiRevokeCredentialRequest = {
  
  id: "id_example",
};

const data = await apiInstance.revokeCredential(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] |  | defaults to undefined


### Return type

**CredentialRevokeResponse**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth)

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

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **verifyCredential**
> CredentialVerifyResponse verifyCredential()

Verifies that the credential exists, is not revoked, and has not expired. Returns the complete credential object when verified.

### Example


```typescript
import { createConfiguration, CredentialsApi } from '';
import type { CredentialsApiVerifyCredentialRequest } from '';

const configuration = createConfiguration();
const apiInstance = new CredentialsApi(configuration);

const request: CredentialsApiVerifyCredentialRequest = {
    // Identifier of the credential to verify
  id: "id_example",
};

const data = await apiInstance.verifyCredential(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] | Identifier of the credential to verify | defaults to undefined


### Return type

**CredentialVerifyResponse**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth), [BearerAuth](README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Verification evaluation result |  -  |
**401** | Unauthorized |  -  |
**403** | Forbidden - missing credentials:read scope |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)


