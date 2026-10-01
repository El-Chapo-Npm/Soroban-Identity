# PollEvents200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Events** | Pointer to **[]map[string]interface{}** |  | [optional] 
**LastEventId** | Pointer to **string** | Cursor to send back on the next call. | [optional] 
**Count** | Pointer to **int32** |  | [optional] 
**TimedOut** | Pointer to **bool** |  | [optional] 

## Methods

### NewPollEvents200Response

`func NewPollEvents200Response() *PollEvents200Response`

NewPollEvents200Response instantiates a new PollEvents200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewPollEvents200ResponseWithDefaults

`func NewPollEvents200ResponseWithDefaults() *PollEvents200Response`

NewPollEvents200ResponseWithDefaults instantiates a new PollEvents200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetEvents

`func (o *PollEvents200Response) GetEvents() []map[string]interface{}`

GetEvents returns the Events field if non-nil, zero value otherwise.

### GetEventsOk

`func (o *PollEvents200Response) GetEventsOk() (*[]map[string]interface{}, bool)`

GetEventsOk returns a tuple with the Events field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEvents

`func (o *PollEvents200Response) SetEvents(v []map[string]interface{})`

SetEvents sets Events field to given value.

### HasEvents

`func (o *PollEvents200Response) HasEvents() bool`

HasEvents returns a boolean if a field has been set.

### GetLastEventId

`func (o *PollEvents200Response) GetLastEventId() string`

GetLastEventId returns the LastEventId field if non-nil, zero value otherwise.

### GetLastEventIdOk

`func (o *PollEvents200Response) GetLastEventIdOk() (*string, bool)`

GetLastEventIdOk returns a tuple with the LastEventId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLastEventId

`func (o *PollEvents200Response) SetLastEventId(v string)`

SetLastEventId sets LastEventId field to given value.

### HasLastEventId

`func (o *PollEvents200Response) HasLastEventId() bool`

HasLastEventId returns a boolean if a field has been set.

### GetCount

`func (o *PollEvents200Response) GetCount() int32`

GetCount returns the Count field if non-nil, zero value otherwise.

### GetCountOk

`func (o *PollEvents200Response) GetCountOk() (*int32, bool)`

GetCountOk returns a tuple with the Count field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetCount

`func (o *PollEvents200Response) SetCount(v int32)`

SetCount sets Count field to given value.

### HasCount

`func (o *PollEvents200Response) HasCount() bool`

HasCount returns a boolean if a field has been set.

### GetTimedOut

`func (o *PollEvents200Response) GetTimedOut() bool`

GetTimedOut returns the TimedOut field if non-nil, zero value otherwise.

### GetTimedOutOk

`func (o *PollEvents200Response) GetTimedOutOk() (*bool, bool)`

GetTimedOutOk returns a tuple with the TimedOut field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimedOut

`func (o *PollEvents200Response) SetTimedOut(v bool)`

SetTimedOut sets TimedOut field to given value.

### HasTimedOut

`func (o *PollEvents200Response) HasTimedOut() bool`

HasTimedOut returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


