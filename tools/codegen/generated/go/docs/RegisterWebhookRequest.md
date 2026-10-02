# RegisterWebhookRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Url** | **string** |  | 
**Events** | Pointer to **[]string** |  | [optional] [default to {"*"}]
**Secret** | Pointer to **string** |  | [optional] 
**AuthToken** | Pointer to **string** |  | [optional] 
**Description** | Pointer to **string** |  | [optional] 

## Methods

### NewRegisterWebhookRequest

`func NewRegisterWebhookRequest(url string, ) *RegisterWebhookRequest`

NewRegisterWebhookRequest instantiates a new RegisterWebhookRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewRegisterWebhookRequestWithDefaults

`func NewRegisterWebhookRequestWithDefaults() *RegisterWebhookRequest`

NewRegisterWebhookRequestWithDefaults instantiates a new RegisterWebhookRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetUrl

`func (o *RegisterWebhookRequest) GetUrl() string`

GetUrl returns the Url field if non-nil, zero value otherwise.

### GetUrlOk

`func (o *RegisterWebhookRequest) GetUrlOk() (*string, bool)`

GetUrlOk returns a tuple with the Url field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUrl

`func (o *RegisterWebhookRequest) SetUrl(v string)`

SetUrl sets Url field to given value.


### GetEvents

`func (o *RegisterWebhookRequest) GetEvents() []string`

GetEvents returns the Events field if non-nil, zero value otherwise.

### GetEventsOk

`func (o *RegisterWebhookRequest) GetEventsOk() (*[]string, bool)`

GetEventsOk returns a tuple with the Events field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEvents

`func (o *RegisterWebhookRequest) SetEvents(v []string)`

SetEvents sets Events field to given value.

### HasEvents

`func (o *RegisterWebhookRequest) HasEvents() bool`

HasEvents returns a boolean if a field has been set.

### GetSecret

`func (o *RegisterWebhookRequest) GetSecret() string`

GetSecret returns the Secret field if non-nil, zero value otherwise.

### GetSecretOk

`func (o *RegisterWebhookRequest) GetSecretOk() (*string, bool)`

GetSecretOk returns a tuple with the Secret field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSecret

`func (o *RegisterWebhookRequest) SetSecret(v string)`

SetSecret sets Secret field to given value.

### HasSecret

`func (o *RegisterWebhookRequest) HasSecret() bool`

HasSecret returns a boolean if a field has been set.

### GetAuthToken

`func (o *RegisterWebhookRequest) GetAuthToken() string`

GetAuthToken returns the AuthToken field if non-nil, zero value otherwise.

### GetAuthTokenOk

`func (o *RegisterWebhookRequest) GetAuthTokenOk() (*string, bool)`

GetAuthTokenOk returns a tuple with the AuthToken field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAuthToken

`func (o *RegisterWebhookRequest) SetAuthToken(v string)`

SetAuthToken sets AuthToken field to given value.

### HasAuthToken

`func (o *RegisterWebhookRequest) HasAuthToken() bool`

HasAuthToken returns a boolean if a field has been set.

### GetDescription

`func (o *RegisterWebhookRequest) GetDescription() string`

GetDescription returns the Description field if non-nil, zero value otherwise.

### GetDescriptionOk

`func (o *RegisterWebhookRequest) GetDescriptionOk() (*string, bool)`

GetDescriptionOk returns a tuple with the Description field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDescription

`func (o *RegisterWebhookRequest) SetDescription(v string)`

SetDescription sets Description field to given value.

### HasDescription

`func (o *RegisterWebhookRequest) HasDescription() bool`

HasDescription returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


