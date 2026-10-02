# .SystemApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**getHealth**](SystemApi.md#getHealth) | **GET** /health | Liveness and contract health probe
[**getMetrics**](SystemApi.md#getMetrics) | **GET** /metrics | Prometheus Metrics
[**getOpenApi**](SystemApi.md#getOpenApi) | **GET** /openapi.json | Get OpenAPI Specification
[**getServerInfo**](SystemApi.md#getServerInfo) | **GET** /info | Server capability discovery


# **getHealth**
> HealthResponse getHealth()

Checks connectivity to Soroban RPC node and smart contracts with circuit breaker state.

### Example


```typescript
import { createConfiguration, SystemApi } from '';

const configuration = createConfiguration();
const apiInstance = new SystemApi(configuration);

const request = {};

const data = await apiInstance.getHealth(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters
This endpoint does not need any parameter.


### Return type

**HealthResponse**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Server and all upstream contracts are healthy |  -  |
**503** | Server or upstream contracts are degraded |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **getMetrics**
> string getMetrics()

Renders Prometheus-formatted operational metrics.

### Example


```typescript
import { createConfiguration, SystemApi } from '';

const configuration = createConfiguration();
const apiInstance = new SystemApi(configuration);

const request = {};

const data = await apiInstance.getMetrics(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters
This endpoint does not need any parameter.


### Return type

**string**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: text/plain


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Prometheus text metrics |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **getOpenApi**
> any getOpenApi()

Returns the complete OpenAPI 3.0.3 specification JSON.

### Example


```typescript
import { createConfiguration, SystemApi } from '';

const configuration = createConfiguration();
const apiInstance = new SystemApi(configuration);

const request = {};

const data = await apiInstance.getOpenApi(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters
This endpoint does not need any parameter.


### Return type

**any**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | OpenAPI specification document |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **getServerInfo**
> ServerInfo getServerInfo()

Returns server version, API versioning info, and supported feature flags.

### Example


```typescript
import { createConfiguration, SystemApi } from '';

const configuration = createConfiguration();
const apiInstance = new SystemApi(configuration);

const request = {};

const data = await apiInstance.getServerInfo(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters
This endpoint does not need any parameter.


### Return type

**ServerInfo**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Server capability metadata |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)


