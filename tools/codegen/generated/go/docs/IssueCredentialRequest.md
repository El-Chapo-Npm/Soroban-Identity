# IssueCredentialRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | **string** | Unique identifier for the credential | 
**Subject** | **string** | Stellar public address of the credential subject | 
**Issuer** | **string** | Stellar public address of the credential issuer | 
**ExpiresAt** | Pointer to **float32** | Unix timestamp in seconds (0 &#x3D; no expiry) | [optional] 
**Schema** | Pointer to **string** | Schema URI | [optional] 
**Claims** | Pointer to **map[string]interface{}** | Arbitrary claim dictionary | [optional] 

## Methods

### NewIssueCredentialRequest

`func NewIssueCredentialRequest(id string, subject string, issuer string, ) *IssueCredentialRequest`

NewIssueCredentialRequest instantiates a new IssueCredentialRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewIssueCredentialRequestWithDefaults

`func NewIssueCredentialRequestWithDefaults() *IssueCredentialRequest`

NewIssueCredentialRequestWithDefaults instantiates a new IssueCredentialRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *IssueCredentialRequest) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *IssueCredentialRequest) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *IssueCredentialRequest) SetId(v string)`

SetId sets Id field to given value.


### GetSubject

`func (o *IssueCredentialRequest) GetSubject() string`

GetSubject returns the Subject field if non-nil, zero value otherwise.

### GetSubjectOk

`func (o *IssueCredentialRequest) GetSubjectOk() (*string, bool)`

GetSubjectOk returns a tuple with the Subject field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSubject

`func (o *IssueCredentialRequest) SetSubject(v string)`

SetSubject sets Subject field to given value.


### GetIssuer

`func (o *IssueCredentialRequest) GetIssuer() string`

GetIssuer returns the Issuer field if non-nil, zero value otherwise.

### GetIssuerOk

`func (o *IssueCredentialRequest) GetIssuerOk() (*string, bool)`

GetIssuerOk returns a tuple with the Issuer field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIssuer

`func (o *IssueCredentialRequest) SetIssuer(v string)`

SetIssuer sets Issuer field to given value.


### GetExpiresAt

`func (o *IssueCredentialRequest) GetExpiresAt() float32`

GetExpiresAt returns the ExpiresAt field if non-nil, zero value otherwise.

### GetExpiresAtOk

`func (o *IssueCredentialRequest) GetExpiresAtOk() (*float32, bool)`

GetExpiresAtOk returns a tuple with the ExpiresAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetExpiresAt

`func (o *IssueCredentialRequest) SetExpiresAt(v float32)`

SetExpiresAt sets ExpiresAt field to given value.

### HasExpiresAt

`func (o *IssueCredentialRequest) HasExpiresAt() bool`

HasExpiresAt returns a boolean if a field has been set.

### GetSchema

`func (o *IssueCredentialRequest) GetSchema() string`

GetSchema returns the Schema field if non-nil, zero value otherwise.

### GetSchemaOk

`func (o *IssueCredentialRequest) GetSchemaOk() (*string, bool)`

GetSchemaOk returns a tuple with the Schema field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSchema

`func (o *IssueCredentialRequest) SetSchema(v string)`

SetSchema sets Schema field to given value.

### HasSchema

`func (o *IssueCredentialRequest) HasSchema() bool`

HasSchema returns a boolean if a field has been set.

### GetClaims

`func (o *IssueCredentialRequest) GetClaims() map[string]interface{}`

GetClaims returns the Claims field if non-nil, zero value otherwise.

### GetClaimsOk

`func (o *IssueCredentialRequest) GetClaimsOk() (*map[string]interface{}, bool)`

GetClaimsOk returns a tuple with the Claims field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetClaims

`func (o *IssueCredentialRequest) SetClaims(v map[string]interface{})`

SetClaims sets Claims field to given value.

### HasClaims

`func (o *IssueCredentialRequest) HasClaims() bool`

HasClaims returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


