# ExecuteBatch200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Results** | Pointer to [**[]ExecuteBatch200ResponseResultsInner**](ExecuteBatch200ResponseResultsInner.md) |  | [optional] 
**Summary** | Pointer to [**ExecuteBatch200ResponseSummary**](ExecuteBatch200ResponseSummary.md) |  | [optional] 
**Atomic** | Pointer to **bool** |  | [optional] 
**Aborted** | Pointer to **bool** |  | [optional] 

## Methods

### NewExecuteBatch200Response

`func NewExecuteBatch200Response() *ExecuteBatch200Response`

NewExecuteBatch200Response instantiates a new ExecuteBatch200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecuteBatch200ResponseWithDefaults

`func NewExecuteBatch200ResponseWithDefaults() *ExecuteBatch200Response`

NewExecuteBatch200ResponseWithDefaults instantiates a new ExecuteBatch200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetResults

`func (o *ExecuteBatch200Response) GetResults() []ExecuteBatch200ResponseResultsInner`

GetResults returns the Results field if non-nil, zero value otherwise.

### GetResultsOk

`func (o *ExecuteBatch200Response) GetResultsOk() (*[]ExecuteBatch200ResponseResultsInner, bool)`

GetResultsOk returns a tuple with the Results field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetResults

`func (o *ExecuteBatch200Response) SetResults(v []ExecuteBatch200ResponseResultsInner)`

SetResults sets Results field to given value.

### HasResults

`func (o *ExecuteBatch200Response) HasResults() bool`

HasResults returns a boolean if a field has been set.

### GetSummary

`func (o *ExecuteBatch200Response) GetSummary() ExecuteBatch200ResponseSummary`

GetSummary returns the Summary field if non-nil, zero value otherwise.

### GetSummaryOk

`func (o *ExecuteBatch200Response) GetSummaryOk() (*ExecuteBatch200ResponseSummary, bool)`

GetSummaryOk returns a tuple with the Summary field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSummary

`func (o *ExecuteBatch200Response) SetSummary(v ExecuteBatch200ResponseSummary)`

SetSummary sets Summary field to given value.

### HasSummary

`func (o *ExecuteBatch200Response) HasSummary() bool`

HasSummary returns a boolean if a field has been set.

### GetAtomic

`func (o *ExecuteBatch200Response) GetAtomic() bool`

GetAtomic returns the Atomic field if non-nil, zero value otherwise.

### GetAtomicOk

`func (o *ExecuteBatch200Response) GetAtomicOk() (*bool, bool)`

GetAtomicOk returns a tuple with the Atomic field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAtomic

`func (o *ExecuteBatch200Response) SetAtomic(v bool)`

SetAtomic sets Atomic field to given value.

### HasAtomic

`func (o *ExecuteBatch200Response) HasAtomic() bool`

HasAtomic returns a boolean if a field has been set.

### GetAborted

`func (o *ExecuteBatch200Response) GetAborted() bool`

GetAborted returns the Aborted field if non-nil, zero value otherwise.

### GetAbortedOk

`func (o *ExecuteBatch200Response) GetAbortedOk() (*bool, bool)`

GetAbortedOk returns a tuple with the Aborted field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAborted

`func (o *ExecuteBatch200Response) SetAborted(v bool)`

SetAborted sets Aborted field to given value.

### HasAborted

`func (o *ExecuteBatch200Response) HasAborted() bool`

HasAborted returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


