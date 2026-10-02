# .WebhooksApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**deleteWebhook**](WebhooksApi.md#deleteWebhook) | **DELETE** /webhooks/{id} | Delete webhook
[**getWebhook**](WebhooksApi.md#getWebhook) | **GET** /webhooks/{id} | Get webhook by ID
[**listWebhookLogs**](WebhooksApi.md#listWebhookLogs) | **GET** /webhooks/logs | Query webhook delivery logs
[**listWebhooks**](WebhooksApi.md#listWebhooks) | **GET** /webhooks | List registered webhooks
[**registerWebhook**](WebhooksApi.md#registerWebhook) | **POST** /webhooks | Register a new webhook endpoint
[**testWebhook**](WebhooksApi.md#testWebhook) | **POST** /webhooks/{id}/test | Test webhook delivery


# **deleteWebhook**
> DeleteWebhook200Response deleteWebhook()


### Example


```typescript
import { createConfiguration, WebhooksApi } from '';
import type { WebhooksApiDeleteWebhookRequest } from '';

const configuration = createConfiguration();
const apiInstance = new WebhooksApi(configuration);

const request: WebhooksApiDeleteWebhookRequest = {
  
  id: "id_example",
};

const data = await apiInstance.deleteWebhook(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] |  | defaults to undefined


### Return type

**DeleteWebhook200Response**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Webhook deleted |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **getWebhook**
> Webhook getWebhook()


### Example


```typescript
import { createConfiguration, WebhooksApi } from '';
import type { WebhooksApiGetWebhookRequest } from '';

const configuration = createConfiguration();
const apiInstance = new WebhooksApi(configuration);

const request: WebhooksApiGetWebhookRequest = {
  
  id: "id_example",
};

const data = await apiInstance.getWebhook(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] |  | defaults to undefined


### Return type

**Webhook**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Webhook details |  -  |
**404** | Webhook not found |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **listWebhookLogs**
> ListWebhookLogs200Response listWebhookLogs()


### Example


```typescript
import { createConfiguration, WebhooksApi } from '';
import type { WebhooksApiListWebhookLogsRequest } from '';

const configuration = createConfiguration();
const apiInstance = new WebhooksApi(configuration);

const request: WebhooksApiListWebhookLogsRequest = {
  
  webhookId: "webhookId_example",
  
  limit: 50,
};

const data = await apiInstance.listWebhookLogs(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **webhookId** | [**string**] |  | (optional) defaults to undefined
 **limit** | [**number**] |  | (optional) defaults to 50


### Return type

**ListWebhookLogs200Response**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Delivery logs |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **listWebhooks**
> ListWebhooks200Response listWebhooks()


### Example


```typescript
import { createConfiguration, WebhooksApi } from '';

const configuration = createConfiguration();
const apiInstance = new WebhooksApi(configuration);

const request = {};

const data = await apiInstance.listWebhooks(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters
This endpoint does not need any parameter.


### Return type

**ListWebhooks200Response**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | List of webhooks |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **registerWebhook**
> Webhook registerWebhook(registerWebhookRequest)


### Example


```typescript
import { createConfiguration, WebhooksApi } from '';
import type { WebhooksApiRegisterWebhookRequest } from '';

const configuration = createConfiguration();
const apiInstance = new WebhooksApi(configuration);

const request: WebhooksApiRegisterWebhookRequest = {
  
  registerWebhookRequest: {
    url: "url_example",
    events: ["*"],
    secret: "secret_example",
    authToken: "authToken_example",
    description: "description_example",
  },
};

const data = await apiInstance.registerWebhook(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **registerWebhookRequest** | **RegisterWebhookRequest**|  |


### Return type

**Webhook**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Webhook registered successfully |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **testWebhook**
> WebhookLog testWebhook()


### Example


```typescript
import { createConfiguration, WebhooksApi } from '';
import type { WebhooksApiTestWebhookRequest } from '';

const configuration = createConfiguration();
const apiInstance = new WebhooksApi(configuration);

const request: WebhooksApiTestWebhookRequest = {
  
  id: "id_example",
};

const data = await apiInstance.testWebhook(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **id** | [**string**] |  | defaults to undefined


### Return type

**WebhookLog**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Test delivery result |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)


