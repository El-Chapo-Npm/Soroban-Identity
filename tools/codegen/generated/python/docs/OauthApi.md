# soroban_identity_client.OauthApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**oauth_authorize**](OauthApi.md#oauth_authorize) | **GET** /oauth/authorize | Authorization endpoint (authorization code grant)
[**oauth_introspect**](OauthApi.md#oauth_introspect) | **POST** /oauth/introspect | Token introspection (RFC 7662)
[**oauth_revoke**](OauthApi.md#oauth_revoke) | **POST** /oauth/revoke | Token revocation (RFC 7009)
[**oauth_token**](OauthApi.md#oauth_token) | **POST** /oauth/token | Token endpoint
[**register_oauth_client**](OauthApi.md#register_oauth_client) | **POST** /oauth/clients | Register an OAuth 2.0 client


# **oauth_authorize**
> oauth_authorize(response_type, client_id, redirect_uri, scope=scope, state=state)

Authorization endpoint (authorization code grant)

Issues a short-lived authorization code and redirects to redirect_uri. There is no separate login/consent page: the resource owner is whoever this request is already authenticated as, and a requested scope can never exceed both the client's registered scopes and the caller's own.

### Example

* Api Key Authentication (ApiKeyAuth):
* Bearer Authentication (BearerAuth):

```python
import soroban_identity_client
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
    api_instance = soroban_identity_client.OauthApi(api_client)
    response_type = 'response_type_example' # str | 
    client_id = 'client_id_example' # str | 
    redirect_uri = 'redirect_uri_example' # str | 
    scope = 'scope_example' # str | Space-delimited scopes. Defaults to the client's full registered scope set. (optional)
    state = 'state_example' # str | Opaque value echoed back unchanged, to protect against CSRF. (optional)

    try:
        # Authorization endpoint (authorization code grant)
        api_instance.oauth_authorize(response_type, client_id, redirect_uri, scope=scope, state=state)
    except Exception as e:
        print("Exception when calling OauthApi->oauth_authorize: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **response_type** | **str**|  | 
 **client_id** | **str**|  | 
 **redirect_uri** | **str**|  | 
 **scope** | **str**| Space-delimited scopes. Defaults to the client&#39;s full registered scope set. | [optional] 
 **state** | **str**| Opaque value echoed back unchanged, to protect against CSRF. | [optional] 

### Return type

void (empty response body)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: Not defined
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**302** | Redirect to redirect_uri with code and state query parameters. |  -  |
**400** | Invalid request, unknown client, or unregistered redirect_uri |  -  |
**401** | Missing or invalid credentials |  -  |
**403** | Caller does not hold a requested scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **oauth_introspect**
> OauthIntrospect200Response oauth_introspect(oauth_introspect_request)

Token introspection (RFC 7662)

Reports whether a token is currently active. Callers authenticate either as the OAuth client the token was issued to (client_id/client_secret in the body) or as an admin (admin:read).

### Example

* Api Key Authentication (ApiKeyAuth):
* Bearer Authentication (BearerAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.oauth_introspect200_response import OauthIntrospect200Response
from soroban_identity_client.models.oauth_introspect_request import OauthIntrospectRequest
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
    api_instance = soroban_identity_client.OauthApi(api_client)
    oauth_introspect_request = soroban_identity_client.OauthIntrospectRequest() # OauthIntrospectRequest | 

    try:
        # Token introspection (RFC 7662)
        api_response = api_instance.oauth_introspect(oauth_introspect_request)
        print("The response of OauthApi->oauth_introspect:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OauthApi->oauth_introspect: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **oauth_introspect_request** | [**OauthIntrospectRequest**](OauthIntrospectRequest.md)|  | 

### Return type

[**OauthIntrospect200Response**](OauthIntrospect200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Introspection result |  -  |
**401** | Missing or invalid credentials |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **oauth_revoke**
> OauthRevoke200Response oauth_revoke(oauth_introspect_request)

Token revocation (RFC 7009)

Revokes an access or refresh token. Always responds 200 once the caller's own credentials check out, whether or not the token was recognized, so a caller cannot use this endpoint to probe for valid tokens.

### Example

* Api Key Authentication (ApiKeyAuth):
* Bearer Authentication (BearerAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.oauth_introspect_request import OauthIntrospectRequest
from soroban_identity_client.models.oauth_revoke200_response import OauthRevoke200Response
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
    api_instance = soroban_identity_client.OauthApi(api_client)
    oauth_introspect_request = soroban_identity_client.OauthIntrospectRequest() # OauthIntrospectRequest | 

    try:
        # Token revocation (RFC 7009)
        api_response = api_instance.oauth_revoke(oauth_introspect_request)
        print("The response of OauthApi->oauth_revoke:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OauthApi->oauth_revoke: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **oauth_introspect_request** | [**OauthIntrospectRequest**](OauthIntrospectRequest.md)|  | 

### Return type

[**OauthRevoke200Response**](OauthRevoke200Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Revoked (or already inactive) |  -  |
**401** | Missing or invalid credentials |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **oauth_token**
> OauthToken200Response oauth_token(oauth_token_request)

Token endpoint

Exchanges an authorization code, or a refresh token, for an access token. Accepts a JSON body (not the RFC 6749 form-encoding) to match the rest of this API.

### Example


```python
import soroban_identity_client
from soroban_identity_client.models.oauth_token200_response import OauthToken200Response
from soroban_identity_client.models.oauth_token_request import OauthTokenRequest
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
    api_instance = soroban_identity_client.OauthApi(api_client)
    oauth_token_request = {"grant_type":"authorization_code","code":"ac_...","redirect_uri":"https://partner.example.com/callback","client_id":"client_...","client_secret":"secret_..."} # OauthTokenRequest | 

    try:
        # Token endpoint
        api_response = api_instance.oauth_token(oauth_token_request)
        print("The response of OauthApi->oauth_token:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OauthApi->oauth_token: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **oauth_token_request** | [**OauthTokenRequest**](OauthTokenRequest.md)|  | 

### Return type

[**OauthToken200Response**](OauthToken200Response.md)

### Authorization

No authorization required

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Token issued |  -  |
**400** | invalid_request / invalid_grant / invalid_scope |  -  |
**401** | invalid_client |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

# **register_oauth_client**
> RegisterOauthClient201Response register_oauth_client(register_oauth_client_request)

Register an OAuth 2.0 client

Dynamically registers a client for the authorization code grant. The client_secret is returned only in this response and cannot be retrieved again.

### Example

* Api Key Authentication (ApiKeyAuth):
* Bearer Authentication (BearerAuth):

```python
import soroban_identity_client
from soroban_identity_client.models.register_oauth_client201_response import RegisterOauthClient201Response
from soroban_identity_client.models.register_oauth_client_request import RegisterOauthClientRequest
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
    api_instance = soroban_identity_client.OauthApi(api_client)
    register_oauth_client_request = {"name":"Partner Dashboard","redirectUris":["https://partner.example.com/callback"],"scopes":["credentials:read"]} # RegisterOauthClientRequest | 

    try:
        # Register an OAuth 2.0 client
        api_response = api_instance.register_oauth_client(register_oauth_client_request)
        print("The response of OauthApi->register_oauth_client:\n")
        pprint(api_response)
    except Exception as e:
        print("Exception when calling OauthApi->register_oauth_client: %s\n" % e)
```



### Parameters


Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **register_oauth_client_request** | [**RegisterOauthClientRequest**](RegisterOauthClientRequest.md)|  | 

### Return type

[**RegisterOauthClient201Response**](RegisterOauthClient201Response.md)

### Authorization

[ApiKeyAuth](../README.md#ApiKeyAuth), [BearerAuth](../README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json

### HTTP response details

| Status code | Description | Response headers |
|-------------|-------------|------------------|
**201** | Client registered |  -  |
**400** | Invalid registration request |  -  |
**401** | Missing or invalid credentials |  -  |
**403** | Missing admin:write scope |  -  |

[[Back to top]](#) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to Model list]](../README.md#documentation-for-models) [[Back to README]](../README.md)

