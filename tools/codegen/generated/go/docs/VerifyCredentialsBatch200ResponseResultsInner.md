# VerifyCredentialsBatch200ResponseResultsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** |  | 
**Verified** | **bool** |  | 
**Reason** | Pointer to **string** |  | [optional] 
**Credential** | Pointer to **map[string]interface{}** |  | [optional] 

## Methods

### NewVerifyCredentialsBatch200ResponseResultsInner

`func NewVerifyCredentialsBatch200ResponseResultsInner(id string, verified bool, ) *VerifyCredentialsBatch200ResponseResultsInner`

NewVerifyCredentialsBatch200ResponseResultsInner instantiates a new VerifyCredentialsBatch200ResponseResultsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewVerifyCredentialsBatch200ResponseResultsInnerWithDefaults

`func NewVerifyCredentialsBatch200ResponseResultsInnerWithDefaults() *VerifyCredentialsBatch200ResponseResultsInner`

NewVerifyCredentialsBatch200ResponseResultsInnerWithDefaults instantiates a new VerifyCredentialsBatch200ResponseResultsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *VerifyCredentialsBatch200ResponseResultsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *VerifyCredentialsBatch200ResponseResultsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *VerifyCredentialsBatch200ResponseResultsInner) SetId(v string)`

SetId sets Id field to given value.


### GetVerified

`func (o *VerifyCredentialsBatch200ResponseResultsInner) GetVerified() bool`

GetVerified returns the Verified field if non-nil, zero value otherwise.

### GetVerifiedOk

`func (o *VerifyCredentialsBatch200ResponseResultsInner) GetVerifiedOk() (*bool, bool)`

GetVerifiedOk returns a tuple with the Verified field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVerified

`func (o *VerifyCredentialsBatch200ResponseResultsInner) SetVerified(v bool)`

SetVerified sets Verified field to given value.


### GetReason

`func (o *VerifyCredentialsBatch200ResponseResultsInner) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *VerifyCredentialsBatch200ResponseResultsInner) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *VerifyCredentialsBatch200ResponseResultsInner) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *VerifyCredentialsBatch200ResponseResultsInner) HasReason() bool`

HasReason returns a boolean if a field has been set.

### GetCredential

`func (o *VerifyCredentialsBatch200ResponseResultsInner) GetCredential() map[string]interface{}`

GetCredential returns the Credential field if non-nil, zero value otherwise.

### GetCredentialOk

`func (o *VerifyCredentialsBatch200ResponseResultsInner) GetCredentialOk() (*map[string]interface{}, bool)`

GetCredentialOk returns a tuple with the Credential field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCredential

`func (o *VerifyCredentialsBatch200ResponseResultsInner) SetCredential(v map[string]interface{})`

SetCredential sets Credential field to given value.

### HasCredential

`func (o *VerifyCredentialsBatch200ResponseResultsInner) HasCredential() bool`

HasCredential returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


