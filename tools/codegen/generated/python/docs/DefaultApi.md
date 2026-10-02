# soroban_identity_client.DefaultApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**create_api_key**](DefaultApi.md#create_api_key) | **POST** /admin/api-keys | Issue a new API key
[**delete_api_key**](DefaultApi.md#delete_api_key) | **DELETE** /admin/api-keys/{id} | Revoke an API key
[**execute_batch**](DefaultApi.md#execute_batch) | **POST** /batch | Execute multiple credential operations in one request (#749)
[**get_api_key**](DefaultApi.md#get_api_key) | **GET** /admin/api-keys/{id} | Get API key metadata
[**get_quota**](DefaultApi.md#get_quota) | **GET** /quota | Get current API quota usage (#748)
[**list_api_keys**](DefaultApi.md#list_api_keys) | **GET** /admin/api-keys | List API keys
[**poll_events**](DefaultApi.md#poll_events) | **GET** /events/poll | Long-poll for contract events (#750)
[**rotate_api_key**](DefaultApi.md#rotate_api_key) | **POST** /admin/api-keys/{id}/rotate | Rotate an API key
[**verify_credentials_batch**](DefaultApi.md#verify_credentials_batch) | **POST** /credentials/verify/batch | Verify multiple credentials in a single batch request


# **create_api_key**
> create_api_key()

Issue a new API key

Issue an API key with configurable permissions and subscription tier.

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
    api_instance = soroban_identity_client.DefaultApi(api_client)

    try:
        # Issue a new API key
        api_instance.create_api_key()
    except Exception as e:
        print("Exception when calling DefaultApi->create_api_key: %s\n" % e)
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
**201** | API key created |  -  |
**401** | Unauthorized |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **delete_api_key**
> delete_api_key(id)

Revoke an API key

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
    api_instance = soroban_identity_client.DefaultApi(api_client)
    id = 'id_example' # str | 

    try:
        # Revoke an API key
        api_instance.delete_api_key(id)
    except Exception as e:
        print("Exception when calling DefaultApi->delete_api_key: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

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
**200** | API key revoked |  -  |
**404** | API key not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **execute_batch**
> ExecuteBatch200Response execute_batch(execute_batch_request)

Execute multiple credential operations in one request (#749)

Processes up to 100 issue/verify/revoke operations in a single request, returning one result per operation. Partial failures do not abort the batch unless `atomic` is true, in which case the batch stops at the first failure and rolls back any credentials it already issued in this batch.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.execute_batch200_response import ExecuteBatch200Response
from soroban_identity_client.models.execute_batch_request import ExecuteBatchRequest
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
    api_instance = soroban_identity_client.DefaultApi(api_client)
    execute_batch_request = soroban_identity_client.ExecuteBatchRequest() # ExecuteBatchRequest | 

    try:
        # Execute multiple credential operations in one request (#749)
        api_response = api_instance.execute_batch(execute_batch_request)
        print("The response of DefaultApi->execute_batch:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DefaultApi->execute_batch: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **execute_batch_request** | [**ExecuteBatchRequest**](ExecuteBatchRequest.md)|  | 

### Return type

[**ExecuteBatch200Response**](ExecuteBatch200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Batch processed; check each result&#39;s &#x60;success&#x60; field for its individual outcome. |  -  |
**400** | Invalid batch: empty, over 100 operations, or a malformed operation |  -  |
**401** | Unauthorized |  -  |
**403** | Missing credentials:read/credentials:write scope for the operation types present |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_api_key**
> get_api_key(id)

Get API key metadata

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
    api_instance = soroban_identity_client.DefaultApi(api_client)
    id = 'id_example' # str | 

    try:
        # Get API key metadata
        api_instance.get_api_key(id)
    except Exception as e:
        print("Exception when calling DefaultApi->get_api_key: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

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
**200** | API key metadata |  -  |
**404** | API key not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_quota**
> GetQuota200Response get_quota()

Get current API quota usage (#748)

Returns the caller's daily and monthly quota usage for its subscription tier. Independent of rate limiting (X-RateLimit-* headers), which is a separate, rolling per-minute budget.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.get_quota200_response import GetQuota200Response
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
    api_instance = soroban_identity_client.DefaultApi(api_client)

    try:
        # Get current API quota usage (#748)
        api_response = api_instance.get_quota()
        print("The response of DefaultApi->get_quota:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DefaultApi->get_quota: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**GetQuota200Response**](GetQuota200Response.md)

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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_api_keys**
> list_api_keys()

List API keys

Returns metadata for all issued API keys.

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
    api_instance = soroban_identity_client.DefaultApi(api_client)

    try:
        # List API keys
        api_instance.list_api_keys()
    except Exception as e:
        print("Exception when calling DefaultApi->list_api_keys: %s\n" % e)
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
**200** | List of API keys |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **poll_events**
> PollEvents200Response poll_events(contract_id=contract_id, topic=topic, timeout=timeout, last_event_id=last_event_id)

Long-poll for contract events (#750)

Alternative to the GET /events SSE stream for clients that cannot hold an open text/event-stream connection. Holds the request open until at least one matching event arrives or the timeout elapses, then responds once with a JSON batch and closes.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.poll_events200_response import PollEvents200Response
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
    api_instance = soroban_identity_client.DefaultApi(api_client)
    contract_id = 'contract_id_example' # str | Filter to events from one contract. (optional)
    topic = 'topic_example' # str | Comma-separated topic filter, positional (e.g. IDENTITY,updated). (optional)
    timeout = 56 # int | Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000). (optional)
    last_event_id = 'last_event_id_example' # str | Ledger cursor to resume from; also accepted as a `lastEventId` or `since` query param. (optional)

    try:
        # Long-poll for contract events (#750)
        api_response = api_instance.poll_events(contract_id=contract_id, topic=topic, timeout=timeout, last_event_id=last_event_id)
        print("The response of DefaultApi->poll_events:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DefaultApi->poll_events: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **contract_id** | **str**| Filter to events from one contract. | [optional] 
 **topic** | **str**| Comma-separated topic filter, positional (e.g. IDENTITY,updated). | [optional] 
 **timeout** | **int**| Requested timeout in milliseconds, clamped to [1000, LONG_POLL_MAX_TIMEOUT_MS] (default 30000, max 60000). | [optional] 
 **last_event_id** | **str**| Ledger cursor to resume from; also accepted as a &#x60;lastEventId&#x60; or &#x60;since&#x60; query param. | [optional] 

### Return type

[**PollEvents200Response**](PollEvents200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | One batch of matching events, or an empty batch if the request timed out first. |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **rotate_api_key**
> rotate_api_key(id)

Rotate an API key

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
    api_instance = soroban_identity_client.DefaultApi(api_client)
    id = 'id_example' # str | 

    try:
        # Rotate an API key
        api_instance.rotate_api_key(id)
    except Exception as e:
        print("Exception when calling DefaultApi->rotate_api_key: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

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
**200** | API key rotated |  -  |
**404** | API key not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **verify_credentials_batch**
> VerifyCredentialsBatch200Response verify_credentials_batch(verify_credentials_batch_request)

Verify multiple credentials in a single batch request

Verifies up to 50 credentials in a single request for efficiency with partial success handling.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.verify_credentials_batch200_response import VerifyCredentialsBatch200Response
from soroban_identity_client.models.verify_credentials_batch_request import VerifyCredentialsBatchRequest
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
    api_instance = soroban_identity_client.DefaultApi(api_client)
    verify_credentials_batch_request = soroban_identity_client.VerifyCredentialsBatchRequest() # VerifyCredentialsBatchRequest | 

    try:
        # Verify multiple credentials in a single batch request
        api_response = api_instance.verify_credentials_batch(verify_credentials_batch_request)
        print("The response of DefaultApi->verify_credentials_batch:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling DefaultApi->verify_credentials_batch: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **verify_credentials_batch_request** | [**VerifyCredentialsBatchRequest**](VerifyCredentialsBatchRequest.md)|  | 

### Return type

[**VerifyCredentialsBatch200Response**](VerifyCredentialsBatch200Response.md)

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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

