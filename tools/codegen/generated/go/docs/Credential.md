# Credential

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** |  | 
**Subject** | **string** |  | 
**Issuer** | **string** |  | 
**ExpiresAt** | Pointer to **float32** |  | [optional] 
**Revoked** | Pointer to **bool** |  | [optional] 
**RevokedAt** | Pointer to **time.Time** |  | [optional] 
**Schema** | Pointer to **string** |  | [optional] 
**Claims** | Pointer to **map[string]interface{}** |  | [optional] 
**Source** | Pointer to **string** |  | [optional] 
**ExpiryNotifiedAt** | Pointer to **time.Time** |  | [optional] 

## Methods

### NewCredential

`func NewCredential(id string, subject string, issuer string, ) *Credential`

NewCredential instantiates a new Credential object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCredentialWithDefaults

`func NewCredentialWithDefaults() *Credential`

NewCredentialWithDefaults instantiates a new Credential object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *Credential) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *Credential) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *Credential) SetId(v string)`

SetId sets Id field to given value.


### GetSubject

`func (o *Credential) GetSubject() string`

GetSubject returns the Subject field if non-nil, zero value otherwise.

### GetSubjectOk

`func (o *Credential) GetSubjectOk() (*string, bool)`

GetSubjectOk returns a tuple with the Subject field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSubject

`func (o *Credential) SetSubject(v string)`

SetSubject sets Subject field to given value.


### GetIssuer

`func (o *Credential) GetIssuer() string`

GetIssuer returns the Issuer field if non-nil, zero value otherwise.

### GetIssuerOk

`func (o *Credential) GetIssuerOk() (*string, bool)`

GetIssuerOk returns a tuple with the Issuer field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIssuer

`func (o *Credential) SetIssuer(v string)`

SetIssuer sets Issuer field to given value.


### GetExpiresAt

`func (o *Credential) GetExpiresAt() float32`

GetExpiresAt returns the ExpiresAt field if non-nil, zero value otherwise.

### GetExpiresAtOk

`func (o *Credential) GetExpiresAtOk() (*float32, bool)`

GetExpiresAtOk returns a tuple with the ExpiresAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresAt

`func (o *Credential) SetExpiresAt(v float32)`

SetExpiresAt sets ExpiresAt field to given value.

### HasExpiresAt

`func (o *Credential) HasExpiresAt() bool`

HasExpiresAt returns a boolean if a field has been set.

### GetRevoked

`func (o *Credential) GetRevoked() bool`

GetRevoked returns the Revoked field if non-nil, zero value otherwise.

### GetRevokedOk

`func (o *Credential) GetRevokedOk() (*bool, bool)`

GetRevokedOk returns a tuple with the Revoked field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRevoked

`func (o *Credential) SetRevoked(v bool)`

SetRevoked sets Revoked field to given value.

### HasRevoked

`func (o *Credential) HasRevoked() bool`

HasRevoked returns a boolean if a field has been set.

### GetRevokedAt

`func (o *Credential) GetRevokedAt() time.Time`

GetRevokedAt returns the RevokedAt field if non-nil, zero value otherwise.

### GetRevokedAtOk

`func (o *Credential) GetRevokedAtOk() (*time.Time, bool)`

GetRevokedAtOk returns a tuple with the RevokedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRevokedAt

`func (o *Credential) SetRevokedAt(v time.Time)`

SetRevokedAt sets RevokedAt field to given value.

### HasRevokedAt

`func (o *Credential) HasRevokedAt() bool`

HasRevokedAt returns a boolean if a field has been set.

### GetSchema

`func (o *Credential) GetSchema() string`

GetSchema returns the Schema field if non-nil, zero value otherwise.

### GetSchemaOk

`func (o *Credential) GetSchemaOk() (*string, bool)`

GetSchemaOk returns a tuple with the Schema field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSchema

`func (o *Credential) SetSchema(v string)`

SetSchema sets Schema field to given value.

### HasSchema

`func (o *Credential) HasSchema() bool`

HasSchema returns a boolean if a field has been set.

### GetClaims

`func (o *Credential) GetClaims() map[string]interface{}`

GetClaims returns the Claims field if non-nil, zero value otherwise.

### GetClaimsOk

`func (o *Credential) GetClaimsOk() (*map[string]interface{}, bool)`

GetClaimsOk returns a tuple with the Claims field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetClaims

`func (o *Credential) SetClaims(v map[string]interface{})`

SetClaims sets Claims field to given value.

### HasClaims

`func (o *Credential) HasClaims() bool`

HasClaims returns a boolean if a field has been set.

### GetSource

`func (o *Credential) GetSource() string`

GetSource returns the Source field if non-nil, zero value otherwise.

### GetSourceOk

`func (o *Credential) GetSourceOk() (*string, bool)`

GetSourceOk returns a tuple with the Source field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSource

`func (o *Credential) SetSource(v string)`

SetSource sets Source field to given value.

### HasSource

`func (o *Credential) HasSource() bool`

HasSource returns a boolean if a field has been set.

### GetExpiryNotifiedAt

`func (o *Credential) GetExpiryNotifiedAt() time.Time`

GetExpiryNotifiedAt returns the ExpiryNotifiedAt field if non-nil, zero value otherwise.

### GetExpiryNotifiedAtOk

`func (o *Credential) GetExpiryNotifiedAtOk() (*time.Time, bool)`

GetExpiryNotifiedAtOk returns a tuple with the ExpiryNotifiedAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiryNotifiedAt

`func (o *Credential) SetExpiryNotifiedAt(v time.Time)`

SetExpiryNotifiedAt sets ExpiryNotifiedAt field to given value.

### HasExpiryNotifiedAt

`func (o *Credential) HasExpiryNotifiedAt() bool`

HasExpiryNotifiedAt returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


