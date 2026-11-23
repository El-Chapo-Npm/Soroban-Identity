# CredentialRevokeResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Revoked** | **bool** |  | 
**Credential** | [**Credential**](Credential.md) |  | 

## Methods

### NewCredentialRevokeResponse

`func NewCredentialRevokeResponse(revoked bool, credential Credential, ) *CredentialRevokeResponse`

NewCredentialRevokeResponse instantiates a new CredentialRevokeResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCredentialRevokeResponseWithDefaults

`func NewCredentialRevokeResponseWithDefaults() *CredentialRevokeResponse`

NewCredentialRevokeResponseWithDefaults instantiates a new CredentialRevokeResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetRevoked

`func (o *CredentialRevokeResponse) GetRevoked() bool`

GetRevoked returns the Revoked field if non-nil, zero value otherwise.

### GetRevokedOk

`func (o *CredentialRevokeResponse) GetRevokedOk() (*bool, bool)`

GetRevokedOk returns a tuple with the Revoked field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRevoked

`func (o *CredentialRevokeResponse) SetRevoked(v bool)`

SetRevoked sets Revoked field to given value.


### GetCredential

`func (o *CredentialRevokeResponse) GetCredential() Credential`

GetCredential returns the Credential field if non-nil, zero value otherwise.

### GetCredentialOk

`func (o *CredentialRevokeResponse) GetCredentialOk() (*Credential, bool)`

GetCredentialOk returns a tuple with the Credential field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCredential

`func (o *CredentialRevokeResponse) SetCredential(v Credential)`

SetCredential sets Credential field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


