# RegisterOauthClientRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Name** | Pointer to **string** |  | [optional] 
**RedirectUris** | **[]string** |  | 
**Scopes** | Pointer to **[]string** | Subset of the API&#39;s scopes this client may ever be granted. | [optional] 
**GrantTypes** | Pointer to **[]string** |  | [optional] 

## Methods

### NewRegisterOauthClientRequest

`func NewRegisterOauthClientRequest(redirectUris []string, ) *RegisterOauthClientRequest`

NewRegisterOauthClientRequest instantiates a new RegisterOauthClientRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewRegisterOauthClientRequestWithDefaults

`func NewRegisterOauthClientRequestWithDefaults() *RegisterOauthClientRequest`

NewRegisterOauthClientRequestWithDefaults instantiates a new RegisterOauthClientRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetName

`func (o *RegisterOauthClientRequest) GetName() string`

GetName returns the Name field if non-nil, zero value otherwise.

### GetNameOk

`func (o *RegisterOauthClientRequest) GetNameOk() (*string, bool)`

GetNameOk returns a tuple with the Name field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetName

`func (o *RegisterOauthClientRequest) SetName(v string)`

SetName sets Name field to given value.

### HasName

`func (o *RegisterOauthClientRequest) HasName() bool`

HasName returns a boolean if a field has been set.

### GetRedirectUris

`func (o *RegisterOauthClientRequest) GetRedirectUris() []string`

GetRedirectUris returns the RedirectUris field if non-nil, zero value otherwise.

### GetRedirectUrisOk

`func (o *RegisterOauthClientRequest) GetRedirectUrisOk() (*[]string, bool)`

GetRedirectUrisOk returns a tuple with the RedirectUris field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRedirectUris

`func (o *RegisterOauthClientRequest) SetRedirectUris(v []string)`

SetRedirectUris sets RedirectUris field to given value.


### GetScopes

`func (o *RegisterOauthClientRequest) GetScopes() []string`

GetScopes returns the Scopes field if non-nil, zero value otherwise.

### GetScopesOk

`func (o *RegisterOauthClientRequest) GetScopesOk() (*[]string, bool)`

GetScopesOk returns a tuple with the Scopes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetScopes

`func (o *RegisterOauthClientRequest) SetScopes(v []string)`

SetScopes sets Scopes field to given value.

### HasScopes

`func (o *RegisterOauthClientRequest) HasScopes() bool`

HasScopes returns a boolean if a field has been set.

### GetGrantTypes

`func (o *RegisterOauthClientRequest) GetGrantTypes() []string`

GetGrantTypes returns the GrantTypes field if non-nil, zero value otherwise.

### GetGrantTypesOk

`func (o *RegisterOauthClientRequest) GetGrantTypesOk() (*[]string, bool)`

GetGrantTypesOk returns a tuple with the GrantTypes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetGrantTypes

`func (o *RegisterOauthClientRequest) SetGrantTypes(v []string)`

SetGrantTypes sets GrantTypes field to given value.

### HasGrantTypes

`func (o *RegisterOauthClientRequest) HasGrantTypes() bool`

HasGrantTypes returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


