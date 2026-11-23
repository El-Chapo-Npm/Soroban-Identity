# GraphqlPostRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Query** | **string** |  | 
**Variables** | Pointer to **map[string]interface{}** |  | [optional] 
**OperationName** | Pointer to **string** |  | [optional] 

## Methods

### NewGraphqlPostRequest

`func NewGraphqlPostRequest(query string, ) *GraphqlPostRequest`

NewGraphqlPostRequest instantiates a new GraphqlPostRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGraphqlPostRequestWithDefaults

`func NewGraphqlPostRequestWithDefaults() *GraphqlPostRequest`

NewGraphqlPostRequestWithDefaults instantiates a new GraphqlPostRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetQuery

`func (o *GraphqlPostRequest) GetQuery() string`

GetQuery returns the Query field if non-nil, zero value otherwise.

### GetQueryOk

`func (o *GraphqlPostRequest) GetQueryOk() (*string, bool)`

GetQueryOk returns a tuple with the Query field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetQuery

`func (o *GraphqlPostRequest) SetQuery(v string)`

SetQuery sets Query field to given value.


### GetVariables

`func (o *GraphqlPostRequest) GetVariables() map[string]interface{}`

GetVariables returns the Variables field if non-nil, zero value otherwise.

### GetVariablesOk

`func (o *GraphqlPostRequest) GetVariablesOk() (*map[string]interface{}, bool)`

GetVariablesOk returns a tuple with the Variables field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVariables

`func (o *GraphqlPostRequest) SetVariables(v map[string]interface{})`

SetVariables sets Variables field to given value.

### HasVariables

`func (o *GraphqlPostRequest) HasVariables() bool`

HasVariables returns a boolean if a field has been set.

### GetOperationName

`func (o *GraphqlPostRequest) GetOperationName() string`

GetOperationName returns the OperationName field if non-nil, zero value otherwise.

### GetOperationNameOk

`func (o *GraphqlPostRequest) GetOperationNameOk() (*string, bool)`

GetOperationNameOk returns a tuple with the OperationName field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetOperationName

`func (o *GraphqlPostRequest) SetOperationName(v string)`

SetOperationName sets OperationName field to given value.

### HasOperationName

`func (o *GraphqlPostRequest) HasOperationName() bool`

HasOperationName returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


