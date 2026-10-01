# soroban_identity_client.SystemApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**get_health**](SystemApi.md#get_health) | **GET** /health | Liveness and contract health probe
[**get_metrics**](SystemApi.md#get_metrics) | **GET** /metrics | Prometheus Metrics
[**get_open_api**](SystemApi.md#get_open_api) | **GET** /openapi.json | Get OpenAPI Specification
[**get_server_info**](SystemApi.md#get_server_info) | **GET** /info | Server capability discovery


# **get_health**
> HealthResponse get_health()

Liveness and contract health probe

Checks connectivity to Soroban RPC node and smart contracts with circuit breaker state.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.health_response import HealthResponse
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
    api_instance = soroban_identity_client.SystemApi(api_client)

    try:
        # Liveness and contract health probe
        api_response = api_instance.get_health()
        print("The response of SystemApi->get_health:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SystemApi->get_health: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**HealthResponse**](HealthResponse.md)

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

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_metrics**
> str get_metrics()

Prometheus Metrics

Renders Prometheus-formatted operational metrics.

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
    api_instance = soroban_identity_client.SystemApi(api_client)

    try:
        # Prometheus Metrics
        api_response = api_instance.get_metrics()
        print("The response of SystemApi->get_metrics:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SystemApi->get_metrics: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**str**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: text/plain

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Prometheus text metrics |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_open_api**
> object get_open_api()

Get OpenAPI Specification

Returns the complete OpenAPI 3.0.3 specification JSON.

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
    api_instance = soroban_identity_client.SystemApi(api_client)

    try:
        # Get OpenAPI Specification
        api_response = api_instance.get_open_api()
        print("The response of SystemApi->get_open_api:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SystemApi->get_open_api: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

**object**

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | OpenAPI specification document |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **get_server_info**
> ServerInfo get_server_info()

Server capability discovery

Returns server version, API versioning info, and supported feature flags.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.server_info import ServerInfo
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
    api_instance = soroban_identity_client.SystemApi(api_client)

    try:
        # Server capability discovery
        api_response = api_instance.get_server_info()
        print("The response of SystemApi->get_server_info:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling SystemApi->get_server_info: %s\n" % e)
```



### Parameters

This endpoint does not need any parameter.

### Return type

[**ServerInfo**](ServerInfo.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Server capability metadata |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

