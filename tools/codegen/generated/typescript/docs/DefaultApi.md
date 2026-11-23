# .DefaultApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**createApiKey**](DefaultApi.md#createApiKey) | **POST** /admin/api-keys | Issue a new API key
[**deleteApiKey**](DefaultApi.md#deleteApiKey) | **DELETE** /admin/api-keys/{id} | Revoke an API key
[**executeBatch**](DefaultApi.md#executeBatch) | **POST** /batch | Execute multiple credential operations in one request (#749)
[**getApiKey**](DefaultApi.md#getApiKey) | **GET** /admin/api-keys/{id} | Get API key metadata
[**getQuota**](DefaultApi.md#getQuota) | **GET** /quota | Get current API quota usage (#748)
[**listApiKeys**](DefaultApi.md#listApiKeys) | **GET** /admin/api-keys | List API keys
[**pollEvents**](DefaultApi.md#pollEvents) | **GET** /events/poll | Long-poll for contract events (#750)
[**rotateApiKey**](DefaultApi.md#rotateApiKey) | **POST** /admin/api-keys/{id}/rotate | Rotate an API key
[**verifyCredentialsBatch**](DefaultApi.md#verifyCredentialsBatch) | **POST** /credentials/verify/batch | Verify multiple credentials in a single batch request


# **createApiKey**
> void createApiKey()

Issue an API key with configurable permissions and subscription tier.

### Example


```typescript
import { createConfiguration, DefaultApi } from '';

const configuration = createConfiguration();
const apiInstance = new DefaultApi(configuration);

const request = {};

const data = await apiInstance.createApiKey(request);
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
**201** | API key created |  -  |
**401** | Unauthorized |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **deleteApiKey**
> void deleteApiKey()


### Example


```typescript
import { createConfiguration, DefaultApi } from '';
import type { DefaultApiDeleteApiKeyRequest } from '';

const configuration = createConfiguration();
const apiInstance = new DefaultApi(configuration);

const request: DefaultApiDeleteApiKeyRequest = {
  
  id: "id_example",
};

const data = await apiInstance.deleteApiKey(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] |  | defaults to undefined


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
**200** | API key revoked |  -  |
**404** | API key not found |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **executeBatch**
> ExecuteBatch200Response executeBatch(executeBatchRequest)

Processes up to 100 issue/verify/revoke operations in a single request, returning one result per operation. Partial failures do not abort the batch unless `atomic` is true, in which case the batch stops at the first failure and rolls back any credentials it already issued in this batch.

### Example


```typescript
import { createConfiguration, DefaultApi } from '';
import type { DefaultApiExecuteBatchRequest } from '';

const configuration = createConfiguration();
const apiInstance = new DefaultApi(configuration);

const request: DefaultApiExecuteBatchRequest = {
  
  executeBatchRequest: {
    atomic: true,
    operations: [
      {
        id: "id_example",
        type: "issue",
        payload: {},
      },
    ],
  },
};

const data = await apiInstance.executeBatch(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **executeBatchRequest** | **ExecuteBatchRequest**|  |


### Return type

**ExecuteBatch200Response**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Batch processed; check each result\&#39;s &#x60;success&#x60; field for its individual outcome. |  -  |
**400** | Invalid batch: empty, over 100 operations, or a malformed operation |  -  |
**401** | Unauthorized |  -  |
**403** | Missing credentials:read/credentials:write scope for the operation types present |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **getApiKey**
> void getApiKey()


### Example


```typescript
import { createConfiguration, DefaultApi } from '';
import type { DefaultApiGetApiKeyRequest } from '';

const configuration = createConfiguration();
const apiInstance = new DefaultApi(configuration);

const request: DefaultApiGetApiKeyRequest = {
  
  id: "id_example",
};

const data = await apiInstance.getApiKey(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] |  | defaults to undefined


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
**200** | API key metadata |  -  |
**404** | API key not found |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **getQuota**
> GetQuota200Response getQuota()

Returns the caller\'s daily and monthly quota usage for its subscription tier. Independent of rate limiting (X-RateLimit-* headers), which is a separate, rolling per-minute budget.

### Example


```typescript
import { createConfiguration, DefaultApi } from '';

const configuration = createConfiguration();
const apiInstance = new DefaultApi(configuration);

const request = {};

const data = await apiInstance.getQuota(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters
This endpoint does not need any parameter.


### Return type

**GetQuota200Response**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Current quota usage |  -  |
**401** | Unauthorized |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **listApiKeys**
> void listApiKeys()

Returns metadata for all issued API keys.

### Example


```typescript
import { createConfiguration, DefaultApi } from '';

const configuration = createConfiguration();
const apiInstance = new DefaultApi(configuration);

const request = {};

const data = await apiInstance.listApiKeys(request);
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
**200** | List of API keys |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **pollEvents**
> PollEvents200Response pollEvents()

Alternative to the GET /events SSE stream for clients that cannot hold an open text/event-stream connection. Holds the request open until at least one matching event arrives or the timeout elapses, then responds once with a JSON batch and closes.

### Example


```typescript
import { createConfiguration, DefaultApi } from '';
import type { DefaultApiPollEventsRequest } from '';

const configuration = createConfiguration();
const apiInstance = new DefaultApi(configuration);

const request: DefaultApiPollEventsRequest = {
    // Filter to events from one contract. (optional)
  contractId: "contractId_example",
    // Comma-separated topic filter, positional (e.g. IDENTITY,updated). (optional)
  topic: "topic_example",
    // Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000). (optional)
  timeout: 1,
    // Ledger cursor to resume from; also accepted as a `lastEventId` or `since` query param. (optional)
  lastEventID: "Last-Event-ID_example",
};

const data = await apiInstance.pollEvents(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **contractId** | [**string**] | Filter to events from one contract. | (optional) defaults to undefined
 **topic** | [**string**] | Comma-separated topic filter, positional (e.g. IDENTITY,updated). | (optional) defaults to undefined
 **timeout** | [**number**] | Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000). | (optional) defaults to undefined
 **lastEventID** | [**string**] | Ledger cursor to resume from; also accepted as a &#x60;lastEventId&#x60; or &#x60;since&#x60; query param. | (optional) defaults to undefined


### Return type

**PollEvents200Response**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | One batch of matching events, or an empty batch if the request timed out first. |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **rotateApiKey**
> void rotateApiKey()


### Example


```typescript
import { createConfiguration, DefaultApi } from '';
import type { DefaultApiRotateApiKeyRequest } from '';

const configuration = createConfiguration();
const apiInstance = new DefaultApi(configuration);

const request: DefaultApiRotateApiKeyRequest = {
  
  id: "id_example",
};

const data = await apiInstance.rotateApiKey(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] |  | defaults to undefined


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
**200** | API key rotated |  -  |
**404** | API key not found |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **verifyCredentialsBatch**
> VerifyCredentialsBatch200Response verifyCredentialsBatch(verifyCredentialsBatchRequest)

Verifies up to 50 credentials in a single request for efficiency with partial success handling.

### Example


```typescript
import { createConfiguration, DefaultApi } from '';
import type { DefaultApiVerifyCredentialsBatchRequest } from '';

const configuration = createConfiguration();
const apiInstance = new DefaultApi(configuration);

const request: DefaultApiVerifyCredentialsBatchRequest = {
  
  verifyCredentialsBatchRequest: {
    ids: [
      "ids_example",
    ],
  },
};

const data = await apiInstance.verifyCredentialsBatch(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **verifyCredentialsBatchRequest** | **VerifyCredentialsBatchRequest**|  |


### Return type

**VerifyCredentialsBatch200Response**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Batch verification results |  -  |
**400** | Invalid request format or limit exceeded |  -  |
**401** | Unauthorized |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)


