# .OauthApi

All URIs are relative to *http://localhost:3001*

Method | HTTP request | Description
------------- | ------------- | -------------
[**oauthAuthorize**](OauthApi.md#oauthAuthorize) | **GET** /oauth/authorize | Authorization endpoint (authorization code grant)
[**oauthIntrospect**](OauthApi.md#oauthIntrospect) | **POST** /oauth/introspect | Token introspection (RFC 7662)
[**oauthRevoke**](OauthApi.md#oauthRevoke) | **POST** /oauth/revoke | Token revocation (RFC 7009)
[**oauthToken**](OauthApi.md#oauthToken) | **POST** /oauth/token | Token endpoint
[**registerOauthClient**](OauthApi.md#registerOauthClient) | **POST** /oauth/clients | Register an OAuth 2.0 client


# **oauthAuthorize**
> oauthAuthorize()

Issues a short-lived authorization code and redirects to redirect_uri. There is no separate login/consent page: the resource owner is whoever this request is already authenticated as, and a requested scope can never exceed both the client\'s registered scopes and the caller\'s own.

### Example


```typescript
import { createConfiguration, OauthApi } from '';
import type { OauthApiOauthAuthorizeRequest } from '';

const configuration = createConfiguration();
const apiInstance = new OauthApi(configuration);

const request: OauthApiOauthAuthorizeRequest = {
  
  responseType: "code",
  
  clientId: "client_id_example",
  
  redirectUri: "redirect_uri_example",
    // Space-delimited scopes. Defaults to the client\'s full registered scope set. (optional)
  scope: "scope_example",
    // Opaque value echoed back unchanged, to protect against CSRF. (optional)
  state: "state_example",
};

const data = await apiInstance.oauthAuthorize(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **responseType** | [**&#39;code&#39;**]**Array<&#39;code&#39;>** |  | defaults to undefined
 **clientId** | [**string**] |  | defaults to undefined
 **redirectUri** | [**string**] |  | defaults to undefined
 **scope** | [**string**] | Space-delimited scopes. Defaults to the client\&#39;s full registered scope set. | (optional) defaults to undefined
 **state** | [**string**] | Opaque value echoed back unchanged, to protect against CSRF. | (optional) defaults to undefined


### Return type

void (empty response body)

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth), [BearerAuth](README.md#BearerAuth)

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

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **oauthIntrospect**
> OauthIntrospect200Response oauthIntrospect(oauthIntrospectRequest)

Reports whether a token is currently active. Callers authenticate either as the OAuth client the token was issued to (client_id/client_secret in the body) or as an admin (admin:read).

### Example


```typescript
import { createConfiguration, OauthApi } from '';
import type { OauthApiOauthIntrospectRequest } from '';

const configuration = createConfiguration();
const apiInstance = new OauthApi(configuration);

const request: OauthApiOauthIntrospectRequest = {
  
  oauthIntrospectRequest: {
    token: "token_example",
    token_type_hint: "access_token",
    client_id: "client_id_example",
    client_secret: "client_secret_example",
  },
};

const data = await apiInstance.oauthIntrospect(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **oauthIntrospectRequest** | **OauthIntrospectRequest**|  |


### Return type

**OauthIntrospect200Response**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth), [BearerAuth](README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Introspection result |  -  |
**401** | Missing or invalid credentials |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **oauthRevoke**
> OauthRevoke200Response oauthRevoke(oauthIntrospectRequest)

Revokes an access or refresh token. Always responds 200 once the caller\'s own credentials check out, whether or not the token was recognized, so a caller cannot use this endpoint to probe for valid tokens.

### Example


```typescript
import { createConfiguration, OauthApi } from '';
import type { OauthApiOauthRevokeRequest } from '';

const configuration = createConfiguration();
const apiInstance = new OauthApi(configuration);

const request: OauthApiOauthRevokeRequest = {
  
  oauthIntrospectRequest: {
    token: "token_example",
    token_type_hint: "access_token",
    client_id: "client_id_example",
    client_secret: "client_secret_example",
  },
};

const data = await apiInstance.oauthRevoke(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **oauthIntrospectRequest** | **OauthIntrospectRequest**|  |


### Return type

**OauthRevoke200Response**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth), [BearerAuth](README.md#BearerAuth)

### HTTP request headers

 - **Content-Type**: application/json
 - **Accept**: application/json


### HTTP response details
| Status code | Description | Response headers |
|-------------|-------------|------------------|
**200** | Revoked (or already inactive) |  -  |
**401** | Missing or invalid credentials |  -  |

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **oauthToken**
> OauthToken200Response oauthToken(oauthTokenRequest)

Exchanges an authorization code, or a refresh token, for an access token. Accepts a JSON body (not the RFC 6749 form-encoding) to match the rest of this API.

### Example


```typescript
import { createConfiguration, OauthApi } from '';
import type { OauthApiOauthTokenRequest } from '';

const configuration = createConfiguration();
const apiInstance = new OauthApi(configuration);

const request: OauthApiOauthTokenRequest = {
  
  oauthTokenRequest: {
    grant_type: "authorization_code",
    code: "code_example",
    redirect_uri: "redirect_uri_example",
    refresh_token: "refresh_token_example",
    client_id: "client_id_example",
    client_secret: "client_secret_example",
    scope: "scope_example",
  },
};

const data = await apiInstance.oauthToken(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **oauthTokenRequest** | **OauthTokenRequest**|  |


### Return type

**OauthToken200Response**

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

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)

# **registerOauthClient**
> RegisterOauthClient201Response registerOauthClient(registerOauthClientRequest)

Dynamically registers a client for the authorization code grant. The client_secret is returned only in this response and cannot be retrieved again.

### Example


```typescript
import { createConfiguration, OauthApi } from '';
import type { OauthApiRegisterOauthClientRequest } from '';

const configuration = createConfiguration();
const apiInstance = new OauthApi(configuration);

const request: OauthApiRegisterOauthClientRequest = {
  
  registerOauthClientRequest: {
    name: "name_example",
    redirectUris: [
      "redirectUris_example",
    ],
    scopes: [
      "scopes_example",
    ],
    grantTypes: [
      "authorization_code",
    ],
  },
};

const data = await apiInstance.registerOauthClient(request);
console.log('API called successfully. Returned data:', data);
```


### Parameters

Name | Type | Description  | Notes
------------- | ------------- | ------------- | -------------
 **registerOauthClientRequest** | **RegisterOauthClientRequest**|  |


### Return type

**RegisterOauthClient201Response**

### Authorization

[ApiKeyAuth](README.md#ApiKeyAuth), [BearerAuth](README.md#BearerAuth)

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

[[Back to top]](#) [[Back to API list]](README.md#documentation-for-api-endpoints) [[Back to Model list]](README.md#documentation-for-models) [[Back to README]](README.md)


