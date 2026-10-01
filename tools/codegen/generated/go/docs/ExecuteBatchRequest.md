# ExecuteBatchRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Atomic** | Pointer to **bool** | Stop at the first failure and revoke any credentials issued earlier in this batch, instead of continuing through the remaining operations. | [optional] 
**Operations** | [**[]ExecuteBatchRequestOperationsInner**](ExecuteBatchRequestOperationsInner.md) |  | 

## Methods

### NewExecuteBatchRequest

`func NewExecuteBatchRequest(operations []ExecuteBatchRequestOperationsInner, ) *ExecuteBatchRequest`

NewExecuteBatchRequest instantiates a new ExecuteBatchRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecuteBatchRequestWithDefaults

`func NewExecuteBatchRequestWithDefaults() *ExecuteBatchRequest`

NewExecuteBatchRequestWithDefaults instantiates a new ExecuteBatchRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetAtomic

`func (o *ExecuteBatchRequest) GetAtomic() bool`

GetAtomic returns the Atomic field if non-nil, zero value otherwise.

### GetAtomicOk

`func (o *ExecuteBatchRequest) GetAtomicOk() (*bool, bool)`

GetAtomicOk returns a tuple with the Atomic field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAtomic

`func (o *ExecuteBatchRequest) SetAtomic(v bool)`

SetAtomic sets Atomic field to given value.

### HasAtomic

`func (o *ExecuteBatchRequest) HasAtomic() bool`

HasAtomic returns a boolean if a field has been set.

### GetOperations

`func (o *ExecuteBatchRequest) GetOperations() []ExecuteBatchRequestOperationsInner`

GetOperations returns the Operations field if non-nil, zero value otherwise.

### GetOperationsOk

`func (o *ExecuteBatchRequest) GetOperationsOk() (*[]ExecuteBatchRequestOperationsInner, bool)`

GetOperationsOk returns a tuple with the Operations field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOperations

`func (o *ExecuteBatchRequest) SetOperations(v []ExecuteBatchRequestOperationsInner)`

SetOperations sets Operations field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


