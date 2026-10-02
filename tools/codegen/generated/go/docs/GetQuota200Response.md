# GetQuota200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Tier** | Pointer to **string** |  | [optional] 
**Daily** | Pointer to [**GetQuota200ResponseDaily**](GetQuota200ResponseDaily.md) |  | [optional] 
**Monthly** | Pointer to [**GetQuota200ResponseMonthly**](GetQuota200ResponseMonthly.md) |  | [optional] 
**OverageMode** | Pointer to **string** |  | [optional] 

## Methods

### NewGetQuota200Response

`func NewGetQuota200Response() *GetQuota200Response`

NewGetQuota200Response instantiates a new GetQuota200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetQuota200ResponseWithDefaults

`func NewGetQuota200ResponseWithDefaults() *GetQuota200Response`

NewGetQuota200ResponseWithDefaults instantiates a new GetQuota200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTier

`func (o *GetQuota200Response) GetTier() string`

GetTier returns the Tier field if non-nil, zero value otherwise.

### GetTierOk

`func (o *GetQuota200Response) GetTierOk() (*string, bool)`

GetTierOk returns a tuple with the Tier field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTier

`func (o *GetQuota200Response) SetTier(v string)`

SetTier sets Tier field to given value.

### HasTier

`func (o *GetQuota200Response) HasTier() bool`

HasTier returns a boolean if a field has been set.

### GetDaily

`func (o *GetQuota200Response) GetDaily() GetQuota200ResponseDaily`

GetDaily returns the Daily field if non-nil, zero value otherwise.

### GetDailyOk

`func (o *GetQuota200Response) GetDailyOk() (*GetQuota200ResponseDaily, bool)`

GetDailyOk returns a tuple with the Daily field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDaily

`func (o *GetQuota200Response) SetDaily(v GetQuota200ResponseDaily)`

SetDaily sets Daily field to given value.

### HasDaily

`func (o *GetQuota200Response) HasDaily() bool`

HasDaily returns a boolean if a field has been set.

### GetMonthly

`func (o *GetQuota200Response) GetMonthly() GetQuota200ResponseMonthly`

GetMonthly returns the Monthly field if non-nil, zero value otherwise.

### GetMonthlyOk

`func (o *GetQuota200Response) GetMonthlyOk() (*GetQuota200ResponseMonthly, bool)`

GetMonthlyOk returns a tuple with the Monthly field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMonthly

`func (o *GetQuota200Response) SetMonthly(v GetQuota200ResponseMonthly)`

SetMonthly sets Monthly field to given value.

### HasMonthly

`func (o *GetQuota200Response) HasMonthly() bool`

HasMonthly returns a boolean if a field has been set.

### GetOverageMode

`func (o *GetQuota200Response) GetOverageMode() string`

GetOverageMode returns the OverageMode field if non-nil, zero value otherwise.

### GetOverageModeOk

`func (o *GetQuota200Response) GetOverageModeOk() (*string, bool)`

GetOverageModeOk returns a tuple with the OverageMode field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOverageMode

`func (o *GetQuota200Response) SetOverageMode(v string)`

SetOverageMode sets OverageMode field to given value.

### HasOverageMode

`func (o *GetQuota200Response) HasOverageMode() bool`

HasOverageMode returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


