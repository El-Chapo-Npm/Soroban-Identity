# ErrorResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Code** | Pointer to **string** |  | [optional] 
**Error** | Pointer to **string** |  | [optional] 
**Message** | Pointer to **string** |  | [optional] 
**RequiredScopes** | Pointer to **[]string** |  | [optional] 
**MissingScopes** | Pointer to **[]string** |  | [optional] 
**Details** | Pointer to [**[]ErrorResponseDetailsInner**](ErrorResponseDetailsInner.md) |  | [optional] 

## Methods

### NewErrorResponse

`func NewErrorResponse() *ErrorResponse`

NewErrorResponse instantiates a new ErrorResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewErrorResponseWithDefaults

`func NewErrorResponseWithDefaults() *ErrorResponse`

NewErrorResponseWithDefaults instantiates a new ErrorResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetCode

`func (o *ErrorResponse) GetCode() string`

GetCode returns the Code field if non-nil, zero value otherwise.

### GetCodeOk

`func (o *ErrorResponse) GetCodeOk() (*string, bool)`

GetCodeOk returns a tuple with the Code field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCode

`func (o *ErrorResponse) SetCode(v string)`

SetCode sets Code field to given value.

### HasCode

`func (o *ErrorResponse) HasCode() bool`

HasCode returns a boolean if a field has been set.

### GetError

`func (o *ErrorResponse) GetError() string`

GetError returns the Error field if non-nil, zero value otherwise.

### GetErrorOk

`func (o *ErrorResponse) GetErrorOk() (*string, bool)`

GetErrorOk returns a tuple with the Error field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetError

`func (o *ErrorResponse) SetError(v string)`

SetError sets Error field to given value.

### HasError

`func (o *ErrorResponse) HasError() bool`

HasError returns a boolean if a field has been set.

### GetMessage

`func (o *ErrorResponse) GetMessage() string`

GetMessage returns the Message field if non-nil, zero value otherwise.

### GetMessageOk

`func (o *ErrorResponse) GetMessageOk() (*string, bool)`

GetMessageOk returns a tuple with the Message field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessage

`func (o *ErrorResponse) SetMessage(v string)`

SetMessage sets Message field to given value.

### HasMessage

`func (o *ErrorResponse) HasMessage() bool`

HasMessage returns a boolean if a field has been set.

### GetRequiredScopes

`func (o *ErrorResponse) GetRequiredScopes() []string`

GetRequiredScopes returns the RequiredScopes field if non-nil, zero value otherwise.

### GetRequiredScopesOk

`func (o *ErrorResponse) GetRequiredScopesOk() (*[]string, bool)`

GetRequiredScopesOk returns a tuple with the RequiredScopes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRequiredScopes

`func (o *ErrorResponse) SetRequiredScopes(v []string)`

SetRequiredScopes sets RequiredScopes field to given value.

### HasRequiredScopes

`func (o *ErrorResponse) HasRequiredScopes() bool`

HasRequiredScopes returns a boolean if a field has been set.

### GetMissingScopes

`func (o *ErrorResponse) GetMissingScopes() []string`

GetMissingScopes returns the MissingScopes field if non-nil, zero value otherwise.

### GetMissingScopesOk

`func (o *ErrorResponse) GetMissingScopesOk() (*[]string, bool)`

GetMissingScopesOk returns a tuple with the MissingScopes field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMissingScopes

`func (o *ErrorResponse) SetMissingScopes(v []string)`

SetMissingScopes sets MissingScopes field to given value.

### HasMissingScopes

`func (o *ErrorResponse) HasMissingScopes() bool`

HasMissingScopes returns a boolean if a field has been set.

### GetDetails

`func (o *ErrorResponse) GetDetails() []ErrorResponseDetailsInner`

GetDetails returns the Details field if non-nil, zero value otherwise.

### GetDetailsOk

`func (o *ErrorResponse) GetDetailsOk() (*[]ErrorResponseDetailsInner, bool)`

GetDetailsOk returns a tuple with the Details field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDetails

`func (o *ErrorResponse) SetDetails(v []ErrorResponseDetailsInner)`

SetDetails sets Details field to given value.

### HasDetails

`func (o *ErrorResponse) HasDetails() bool`

HasDetails returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


