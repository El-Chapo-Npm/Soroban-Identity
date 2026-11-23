# GetQuota200ResponseMonthly

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Limit** | Pointer to **int32** |  | [optional] 
**Used** | Pointer to **int32** |  | [optional] 
**Remaining** | Pointer to **int32** |  | [optional] 
**ResetAt** | Pointer to **int32** | Unix seconds, 1st of next UTC month | [optional] 

## Methods

### NewGetQuota200ResponseMonthly

`func NewGetQuota200ResponseMonthly() *GetQuota200ResponseMonthly`

NewGetQuota200ResponseMonthly instantiates a new GetQuota200ResponseMonthly object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetQuota200ResponseMonthlyWithDefaults

`func NewGetQuota200ResponseMonthlyWithDefaults() *GetQuota200ResponseMonthly`

NewGetQuota200ResponseMonthlyWithDefaults instantiates a new GetQuota200ResponseMonthly object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetLimit

`func (o *GetQuota200ResponseMonthly) GetLimit() int32`

GetLimit returns the Limit field if non-nil, zero value otherwise.

### GetLimitOk

`func (o *GetQuota200ResponseMonthly) GetLimitOk() (*int32, bool)`

GetLimitOk returns a tuple with the Limit field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLimit

`func (o *GetQuota200ResponseMonthly) SetLimit(v int32)`

SetLimit sets Limit field to given value.

### HasLimit

`func (o *GetQuota200ResponseMonthly) HasLimit() bool`

HasLimit returns a boolean if a field has been set.

### GetUsed

`func (o *GetQuota200ResponseMonthly) GetUsed() int32`

GetUsed returns the Used field if non-nil, zero value otherwise.

### GetUsedOk

`func (o *GetQuota200ResponseMonthly) GetUsedOk() (*int32, bool)`

GetUsedOk returns a tuple with the Used field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUsed

`func (o *GetQuota200ResponseMonthly) SetUsed(v int32)`

SetUsed sets Used field to given value.

### HasUsed

`func (o *GetQuota200ResponseMonthly) HasUsed() bool`

HasUsed returns a boolean if a field has been set.

### GetRemaining

`func (o *GetQuota200ResponseMonthly) GetRemaining() int32`

GetRemaining returns the Remaining field if non-nil, zero value otherwise.

### GetRemainingOk

`func (o *GetQuota200ResponseMonthly) GetRemainingOk() (*int32, bool)`

GetRemainingOk returns a tuple with the Remaining field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetRemaining

`func (o *GetQuota200ResponseMonthly) SetRemaining(v int32)`

SetRemaining sets Remaining field to given value.

### HasRemaining

`func (o *GetQuota200ResponseMonthly) HasRemaining() bool`

HasRemaining returns a boolean if a field has been set.

### GetResetAt

`func (o *GetQuota200ResponseMonthly) GetResetAt() int32`

GetResetAt returns the ResetAt field if non-nil, zero value otherwise.

### GetResetAtOk

`func (o *GetQuota200ResponseMonthly) GetResetAtOk() (*int32, bool)`

GetResetAtOk returns a tuple with the ResetAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResetAt

`func (o *GetQuota200ResponseMonthly) SetResetAt(v int32)`

SetResetAt sets ResetAt field to given value.

### HasResetAt

`func (o *GetQuota200ResponseMonthly) HasResetAt() bool`

HasResetAt returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


