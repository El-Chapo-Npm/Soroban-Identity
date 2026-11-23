# soroban_identity_client.WebhooksApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**delete_webhook**](WebhooksApi.md#delete_webhook) | **DELETE** /webhooks/{id} | Delete webhook
[**get_webhook**](WebhooksApi.md#get_webhook) | **GET** /webhooks/{id} | Get webhook by ID
[**list_webhook_logs**](WebhooksApi.md#list_webhook_logs) | **GET** /webhooks/logs | Query webhook delivery logs
[**list_webhooks**](WebhooksApi.md#list_webhooks) | **GET** /webhooks | List registered webhooks
[**register_webhook**](WebhooksApi.md#register_webhook) | **POST** /webhooks | Register a new webhook endpoint
[**test_webhook**](WebhooksApi.md#test_webhook) | **POST** /webhooks/{id}/test | Test webhook delivery


# **delete_webhook**
> DeleteWebhook200Response delete_webhook(id)

Delete webhook

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.delete_webhook200_response import DeleteWebhook200Response
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
    api_instance = soroban_identity_client.WebhooksApi(api_client)
    id = 'id_example' # str | 

    try:
        # Delete webhook
        api_response = api_instance.delete_webhook(id)
        print("The response of WebhooksApi->delete_webhook:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->delete_webhook: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

### Return type

[**DeleteWebhook200Response**](DeleteWebhook200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Webhook deleted |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_webhook**
> Webhook get_webhook(id)

Get webhook by ID

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.webhook import Webhook
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
    api_instance = soroban_identity_client.WebhooksApi(api_client)
    id = 'id_example' # str | 

    try:
        # Get webhook by ID
        api_response = api_instance.get_webhook(id)
        print("The response of WebhooksApi->get_webhook:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->get_webhook: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

### Return type

[**Webhook**](Webhook.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Webhook details |  -  |
**404** | Webhook not found |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_webhook_logs**
> ListWebhookLogs200Response list_webhook_logs(webhook_id=webhook_id, limit=limit)

Query webhook delivery logs

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.list_webhook_logs200_response import ListWebhookLogs200Response
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
    api_instance = soroban_identity_client.WebhooksApi(api_client)
    webhook_id = 'webhook_id_example' # str |  (optional)
    limit = 50 # int |  (optional) (default to 50)

    try:
        # Query webhook delivery logs
        api_response = api_instance.list_webhook_logs(webhook_id=webhook_id, limit=limit)
        print("The response of WebhooksApi->list_webhook_logs:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->list_webhook_logs: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **webhook_id** | **str**|  | [optional] 
 **limit** | **int**|  | [optional] [default to 50]

### Return type

[**ListWebhookLogs200Response**](ListWebhookLogs200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Delivery logs |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **list_webhooks**
> ListWebhooks200Response list_webhooks()

List registered webhooks

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.list_webhooks200_response import ListWebhooks200Response
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
    api_instance = soroban_identity_client.WebhooksApi(api_client)

    try:
        # List registered webhooks
        api_response = api_instance.list_webhooks()
        print("The response of WebhooksApi->list_webhooks:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->list_webhooks: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**ListWebhooks200Response**](ListWebhooks200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of webhooks |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **register_webhook**
> Webhook register_webhook(register_webhook_request)

Register a new webhook endpoint

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.register_webhook_request import RegisterWebhookRequest
from soroban_identity_client.models.webhook import Webhook
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
    api_instance = soroban_identity_client.WebhooksApi(api_client)
    register_webhook_request = {"url":"https://client.example.com/webhook","events":["credential.issued","credential.revoked"],"secret":"whsec_custom_secret_key_123","description":"Primary webhook listener for credential lifecycle"} # RegisterWebhookRequest | 

    try:
        # Register a new webhook endpoint
        api_response = api_instance.register_webhook(register_webhook_request)
        print("The response of WebhooksApi->register_webhook:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->register_webhook: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **register_webhook_request** | [**RegisterWebhookRequest**](RegisterWebhookRequest.md)|  | 

### Return type

[**Webhook**](Webhook.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Webhook registered successfully |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **test_webhook**
> WebhookLog test_webhook(id)

Test webhook delivery

### Example

* Api Key Authentication (ApiKeyAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.webhook_log import WebhookLog
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
    api_instance = soroban_identity_client.WebhooksApi(api_client)
    id = 'id_example' # str | 

    try:
        # Test webhook delivery
        api_response = api_instance.test_webhook(id)
        print("The response of WebhooksApi->test_webhook:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling WebhooksApi->test_webhook: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | **str**|  | 

### Return type

[**WebhookLog**](WebhookLog.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Test delivery result |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

