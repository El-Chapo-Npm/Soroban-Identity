# ExecuteBatchRequestOperationsInner

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Id** | Pointer to **string** | Optional client-supplied reference echoed back on the matching result. | [optional] 
**Type** | **string** |  | 
**Payload** | **map[string]interface{}** | issue: a full credential body. verify/revoke: { credentialId }. | 

## Methods

### NewExecuteBatchRequestOperationsInner

`func NewExecuteBatchRequestOperationsInner(type_ string, payload map[string]interface{}, ) *ExecuteBatchRequestOperationsInner`

NewExecuteBatchRequestOperationsInner instantiates a new ExecuteBatchRequestOperationsInner object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewExecuteBatchRequestOperationsInnerWithDefaults

`func NewExecuteBatchRequestOperationsInnerWithDefaults() *ExecuteBatchRequestOperationsInner`

NewExecuteBatchRequestOperationsInnerWithDefaults instantiates a new ExecuteBatchRequestOperationsInner object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetId

`func (o *ExecuteBatchRequestOperationsInner) GetId() string`

GetId returns the Id field if non-nil, zero value otherwise.

### GetIdOk

`func (o *ExecuteBatchRequestOperationsInner) GetIdOk() (*string, bool)`

GetIdOk returns a tuple with the Id field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetId

`func (o *ExecuteBatchRequestOperationsInner) SetId(v string)`

SetId sets Id field to given value.

### HasId

`func (o *ExecuteBatchRequestOperationsInner) HasId() bool`

HasId returns a boolean if a field has been set.

### GetType

`func (o *ExecuteBatchRequestOperationsInner) GetType() string`

GetType returns the Type field if non-nil, zero value otherwise.

### GetTypeOk

`func (o *ExecuteBatchRequestOperationsInner) GetTypeOk() (*string, bool)`

GetTypeOk returns a tuple with the Type field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetType

`func (o *ExecuteBatchRequestOperationsInner) SetType(v string)`

SetType sets Type field to given value.


### GetPayload

`func (o *ExecuteBatchRequestOperationsInner) GetPayload() map[string]interface{}`

GetPayload returns the Payload field if non-nil, zero value otherwise.

### GetPayloadOk

`func (o *ExecuteBatchRequestOperationsInner) GetPayloadOk() (*map[string]interface{}, bool)`

GetPayloadOk returns a tuple with the Payload field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPayload

`func (o *ExecuteBatchRequestOperationsInner) SetPayload(v map[string]interface{})`

SetPayload sets Payload field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


