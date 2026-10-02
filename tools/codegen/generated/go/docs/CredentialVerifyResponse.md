# CredentialVerifyResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Verified** | **bool** | True if valid, active, and unexpired | 
**Reason** | Pointer to **NullableString** |  | [optional] 
**Credential** | Pointer to [**Credential**](Credential.md) |  | [optional] 

## Methods

### NewCredentialVerifyResponse

`func NewCredentialVerifyResponse(verified bool, ) *CredentialVerifyResponse`

NewCredentialVerifyResponse instantiates a new CredentialVerifyResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCredentialVerifyResponseWithDefaults

`func NewCredentialVerifyResponseWithDefaults() *CredentialVerifyResponse`

NewCredentialVerifyResponseWithDefaults instantiates a new CredentialVerifyResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetVerified

`func (o *CredentialVerifyResponse) GetVerified() bool`

GetVerified returns the Verified field if non-nil, zero value otherwise.

### GetVerifiedOk

`func (o *CredentialVerifyResponse) GetVerifiedOk() (*bool, bool)`

GetVerifiedOk returns a tuple with the Verified field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVerified

`func (o *CredentialVerifyResponse) SetVerified(v bool)`

SetVerified sets Verified field to given value.


### GetReason

`func (o *CredentialVerifyResponse) GetReason() string`

GetReason returns the Reason field if non-nil, zero value otherwise.

### GetReasonOk

`func (o *CredentialVerifyResponse) GetReasonOk() (*string, bool)`

GetReasonOk returns a tuple with the Reason field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetReason

`func (o *CredentialVerifyResponse) SetReason(v string)`

SetReason sets Reason field to given value.

### HasReason

`func (o *CredentialVerifyResponse) HasReason() bool`

HasReason returns a boolean if a field has been set.

### SetReasonNil

`func (o *CredentialVerifyResponse) SetReasonNil(b bool)`

 SetReasonNil sets the value for Reason to be an explicit nil

### UnsetReason
`func (o *CredentialVerifyResponse) UnsetReason()`

UnsetReason ensures that no value is present for Reason, not even an explicit nil
### GetCredential

`func (o *CredentialVerifyResponse) GetCredential() Credential`

GetCredential returns the Credential field if non-nil, zero value otherwise.

### GetCredentialOk

`func (o *CredentialVerifyResponse) GetCredentialOk() (*Credential, bool)`

GetCredentialOk returns a tuple with the Credential field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCredential

`func (o *CredentialVerifyResponse) SetCredential(v Credential)`

SetCredential sets Credential field to given value.

### HasCredential

`func (o *CredentialVerifyResponse) HasCredential() bool`

HasCredential returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


