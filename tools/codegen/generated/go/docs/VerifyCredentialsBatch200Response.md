# VerifyCredentialsBatch200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Results** | [**[]VerifyCredentialsBatch200ResponseResultsInner**](VerifyCredentialsBatch200ResponseResultsInner.md) |  | 
**Total** | **int32** |  | 
**VerifiedCount** | **int32** |  | 

## Methods

### NewVerifyCredentialsBatch200Response

`func NewVerifyCredentialsBatch200Response(results []VerifyCredentialsBatch200ResponseResultsInner, total int32, verifiedCount int32, ) *VerifyCredentialsBatch200Response`

NewVerifyCredentialsBatch200Response instantiates a new VerifyCredentialsBatch200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewVerifyCredentialsBatch200ResponseWithDefaults

`func NewVerifyCredentialsBatch200ResponseWithDefaults() *VerifyCredentialsBatch200Response`

NewVerifyCredentialsBatch200ResponseWithDefaults instantiates a new VerifyCredentialsBatch200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetResults

`func (o *VerifyCredentialsBatch200Response) GetResults() []VerifyCredentialsBatch200ResponseResultsInner`

GetResults returns the Results field if non-nil, zero value otherwise.

### GetResultsOk

`func (o *VerifyCredentialsBatch200Response) GetResultsOk() (*[]VerifyCredentialsBatch200ResponseResultsInner, bool)`

GetResultsOk returns a tuple with the Results field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResults

`func (o *VerifyCredentialsBatch200Response) SetResults(v []VerifyCredentialsBatch200ResponseResultsInner)`

SetResults sets Results field to given value.


### GetTotal

`func (o *VerifyCredentialsBatch200Response) GetTotal() int32`

GetTotal returns the Total field if non-nil, zero value otherwise.

### GetTotalOk

`func (o *VerifyCredentialsBatch200Response) GetTotalOk() (*int32, bool)`

GetTotalOk returns a tuple with the Total field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotal

`func (o *VerifyCredentialsBatch200Response) SetTotal(v int32)`

SetTotal sets Total field to given value.


### GetVerifiedCount

`func (o *VerifyCredentialsBatch200Response) GetVerifiedCount() int32`

GetVerifiedCount returns the VerifiedCount field if non-nil, zero value otherwise.

### GetVerifiedCountOk

`func (o *VerifyCredentialsBatch200Response) GetVerifiedCountOk() (*int32, bool)`

GetVerifiedCountOk returns a tuple with the VerifiedCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVerifiedCount

`func (o *VerifyCredentialsBatch200Response) SetVerifiedCount(v int32)`

SetVerifiedCount sets VerifiedCount field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


