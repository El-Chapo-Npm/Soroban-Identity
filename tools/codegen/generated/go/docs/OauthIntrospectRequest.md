# OauthIntrospectRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Token** | **string** |  | 
**TokenTypeHint** | Pointer to **string** |  | [optional] 
**ClientId** | Pointer to **string** |  | [optional] 
**ClientSecret** | Pointer to **string** |  | [optional] 

## Methods

### NewOauthIntrospectRequest

`func NewOauthIntrospectRequest(token string, ) *OauthIntrospectRequest`

NewOauthIntrospectRequest instantiates a new OauthIntrospectRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewOauthIntrospectRequestWithDefaults

`func NewOauthIntrospectRequestWithDefaults() *OauthIntrospectRequest`

NewOauthIntrospectRequestWithDefaults instantiates a new OauthIntrospectRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetToken

`func (o *OauthIntrospectRequest) GetToken() string`

GetToken returns the Token field if non-nil, zero value otherwise.

### GetTokenOk

`func (o *OauthIntrospectRequest) GetTokenOk() (*string, bool)`

GetTokenOk returns a tuple with the Token field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetToken

`func (o *OauthIntrospectRequest) SetToken(v string)`

SetToken sets Token field to given value.


### GetTokenTypeHint

`func (o *OauthIntrospectRequest) GetTokenTypeHint() string`

GetTokenTypeHint returns the TokenTypeHint field if non-nil, zero value otherwise.

### GetTokenTypeHintOk

`func (o *OauthIntrospectRequest) GetTokenTypeHintOk() (*string, bool)`

GetTokenTypeHintOk returns a tuple with the TokenTypeHint field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTokenTypeHint

`func (o *OauthIntrospectRequest) SetTokenTypeHint(v string)`

SetTokenTypeHint sets TokenTypeHint field to given value.

### HasTokenTypeHint

`func (o *OauthIntrospectRequest) HasTokenTypeHint() bool`

HasTokenTypeHint returns a boolean if a field has been set.

### GetClientId

`func (o *OauthIntrospectRequest) GetClientId() string`

GetClientId returns the ClientId field if non-nil, zero value otherwise.

### GetClientIdOk

`func (o *OauthIntrospectRequest) GetClientIdOk() (*string, bool)`

GetClientIdOk returns a tuple with the ClientId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetClientId

`func (o *OauthIntrospectRequest) SetClientId(v string)`

SetClientId sets ClientId field to given value.

### HasClientId

`func (o *OauthIntrospectRequest) HasClientId() bool`

HasClientId returns a boolean if a field has been set.

### GetClientSecret

`func (o *OauthIntrospectRequest) GetClientSecret() string`

GetClientSecret returns the ClientSecret field if non-nil, zero value otherwise.

### GetClientSecretOk

`func (o *OauthIntrospectRequest) GetClientSecretOk() (*string, bool)`

GetClientSecretOk returns a tuple with the ClientSecret field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetClientSecret

`func (o *OauthIntrospectRequest) SetClientSecret(v string)`

SetClientSecret sets ClientSecret field to given value.

### HasClientSecret

`func (o *OauthIntrospectRequest) HasClientSecret() bool`

HasClientSecret returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


