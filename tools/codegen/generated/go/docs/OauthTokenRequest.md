# OauthTokenRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**GrantType** | **string** |  | 
**Code** | Pointer to **string** | Required for grant_type&#x3D;authorization_code | [optional] 
**RedirectUri** | Pointer to **string** | Required for grant_type&#x3D;authorization_code; must match the value used at /oauth/authorize | [optional] 
**RefreshToken** | Pointer to **string** | Required for grant_type&#x3D;refresh_token | [optional] 
**ClientId** | **string** |  | 
**ClientSecret** | **string** |  | 
**Scope** | Pointer to **string** | Optional on refresh; may only narrow the original grant | [optional] 

## Methods

### NewOauthTokenRequest

`func NewOauthTokenRequest(grantType string, clientId string, clientSecret string, ) *OauthTokenRequest`

NewOauthTokenRequest instantiates a new OauthTokenRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewOauthTokenRequestWithDefaults

`func NewOauthTokenRequestWithDefaults() *OauthTokenRequest`

NewOauthTokenRequestWithDefaults instantiates a new OauthTokenRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetGrantType

`func (o *OauthTokenRequest) GetGrantType() string`

GetGrantType returns the GrantType field if non-nil, zero value otherwise.

### GetGrantTypeOk

`func (o *OauthTokenRequest) GetGrantTypeOk() (*string, bool)`

GetGrantTypeOk returns a tuple with the GrantType field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetGrantType

`func (o *OauthTokenRequest) SetGrantType(v string)`

SetGrantType sets GrantType field to given value.


### GetCode

`func (o *OauthTokenRequest) GetCode() string`

GetCode returns the Code field if non-nil, zero value otherwise.

### GetCodeOk

`func (o *OauthTokenRequest) GetCodeOk() (*string, bool)`

GetCodeOk returns a tuple with the Code field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCode

`func (o *OauthTokenRequest) SetCode(v string)`

SetCode sets Code field to given value.

### HasCode

`func (o *OauthTokenRequest) HasCode() bool`

HasCode returns a boolean if a field has been set.

### GetRedirectUri

`func (o *OauthTokenRequest) GetRedirectUri() string`

GetRedirectUri returns the RedirectUri field if non-nil, zero value otherwise.

### GetRedirectUriOk

`func (o *OauthTokenRequest) GetRedirectUriOk() (*string, bool)`

GetRedirectUriOk returns a tuple with the RedirectUri field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRedirectUri

`func (o *OauthTokenRequest) SetRedirectUri(v string)`

SetRedirectUri sets RedirectUri field to given value.

### HasRedirectUri

`func (o *OauthTokenRequest) HasRedirectUri() bool`

HasRedirectUri returns a boolean if a field has been set.

### GetRefreshToken

`func (o *OauthTokenRequest) GetRefreshToken() string`

GetRefreshToken returns the RefreshToken field if non-nil, zero value otherwise.

### GetRefreshTokenOk

`func (o *OauthTokenRequest) GetRefreshTokenOk() (*string, bool)`

GetRefreshTokenOk returns a tuple with the RefreshToken field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRefreshToken

`func (o *OauthTokenRequest) SetRefreshToken(v string)`

SetRefreshToken sets RefreshToken field to given value.

### HasRefreshToken

`func (o *OauthTokenRequest) HasRefreshToken() bool`

HasRefreshToken returns a boolean if a field has been set.

### GetClientId

`func (o *OauthTokenRequest) GetClientId() string`

GetClientId returns the ClientId field if non-nil, zero value otherwise.

### GetClientIdOk

`func (o *OauthTokenRequest) GetClientIdOk() (*string, bool)`

GetClientIdOk returns a tuple with the ClientId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetClientId

`func (o *OauthTokenRequest) SetClientId(v string)`

SetClientId sets ClientId field to given value.


### GetClientSecret

`func (o *OauthTokenRequest) GetClientSecret() string`

GetClientSecret returns the ClientSecret field if non-nil, zero value otherwise.

### GetClientSecretOk

`func (o *OauthTokenRequest) GetClientSecretOk() (*string, bool)`

GetClientSecretOk returns a tuple with the ClientSecret field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetClientSecret

`func (o *OauthTokenRequest) SetClientSecret(v string)`

SetClientSecret sets ClientSecret field to given value.


### GetScope

`func (o *OauthTokenRequest) GetScope() string`

GetScope returns the Scope field if non-nil, zero value otherwise.

### GetScopeOk

`func (o *OauthTokenRequest) GetScopeOk() (*string, bool)`

GetScopeOk returns a tuple with the Scope field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetScope

`func (o *OauthTokenRequest) SetScope(v string)`

SetScope sets Scope field to given value.

### HasScope

`func (o *OauthTokenRequest) HasScope() bool`

HasScope returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


