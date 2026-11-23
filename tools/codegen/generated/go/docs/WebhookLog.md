# WebhookLog

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**DeliveryId** | **string** |  | 
**WebhookId** | **string** |  | 
**Url** | Pointer to **string** |  | [optional] 
**Event** | **string** |  | 
**StatusCode** | Pointer to **int32** |  | [optional] 
**Success** | **bool** |  | 
**Attempt** | Pointer to **int32** |  | [optional] 
**DurationMs** | Pointer to **int32** |  | [optional] 
**Timestamp** | Pointer to **time.Time** |  | [optional] 
**Error** | Pointer to **NullableString** |  | [optional] 

## Methods

### NewWebhookLog

`func NewWebhookLog(deliveryId string, webhookId string, event string, success bool, ) *WebhookLog`

NewWebhookLog instantiates a new WebhookLog object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewWebhookLogWithDefaults

`func NewWebhookLogWithDefaults() *WebhookLog`

NewWebhookLogWithDefaults instantiates a new WebhookLog object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetDeliveryId

`func (o *WebhookLog) GetDeliveryId() string`

GetDeliveryId returns the DeliveryId field if non-nil, zero value otherwise.

### GetDeliveryIdOk

`func (o *WebhookLog) GetDeliveryIdOk() (*string, bool)`

GetDeliveryIdOk returns a tuple with the DeliveryId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDeliveryId

`func (o *WebhookLog) SetDeliveryId(v string)`

SetDeliveryId sets DeliveryId field to given value.


### GetWebhookId

`func (o *WebhookLog) GetWebhookId() string`

GetWebhookId returns the WebhookId field if non-nil, zero value otherwise.

### GetWebhookIdOk

`func (o *WebhookLog) GetWebhookIdOk() (*string, bool)`

GetWebhookIdOk returns a tuple with the WebhookId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWebhookId

`func (o *WebhookLog) SetWebhookId(v string)`

SetWebhookId sets WebhookId field to given value.


### GetUrl

`func (o *WebhookLog) GetUrl() string`

GetUrl returns the Url field if non-nil, zero value otherwise.

### GetUrlOk

`func (o *WebhookLog) GetUrlOk() (*string, bool)`

GetUrlOk returns a tuple with the Url field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUrl

`func (o *WebhookLog) SetUrl(v string)`

SetUrl sets Url field to given value.

### HasUrl

`func (o *WebhookLog) HasUrl() bool`

HasUrl returns a boolean if a field has been set.

### GetEvent

`func (o *WebhookLog) GetEvent() string`

GetEvent returns the Event field if non-nil, zero value otherwise.

### GetEventOk

`func (o *WebhookLog) GetEventOk() (*string, bool)`

GetEventOk returns a tuple with the Event field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEvent

`func (o *WebhookLog) SetEvent(v string)`

SetEvent sets Event field to given value.


### GetStatusCode

`func (o *WebhookLog) GetStatusCode() int32`

GetStatusCode returns the StatusCode field if non-nil, zero value otherwise.

### GetStatusCodeOk

`func (o *WebhookLog) GetStatusCodeOk() (*int32, bool)`

GetStatusCodeOk returns a tuple with the StatusCode field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatusCode

`func (o *WebhookLog) SetStatusCode(v int32)`

SetStatusCode sets StatusCode field to given value.

### HasStatusCode

`func (o *WebhookLog) HasStatusCode() bool`

HasStatusCode returns a boolean if a field has been set.

### GetSuccess

`func (o *WebhookLog) GetSuccess() bool`

GetSuccess returns the Success field if non-nil, zero value otherwise.

### GetSuccessOk

`func (o *WebhookLog) GetSuccessOk() (*bool, bool)`

GetSuccessOk returns a tuple with the Success field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSuccess

`func (o *WebhookLog) SetSuccess(v bool)`

SetSuccess sets Success field to given value.


### GetAttempt

`func (o *WebhookLog) GetAttempt() int32`

GetAttempt returns the Attempt field if non-nil, zero value otherwise.

### GetAttemptOk

`func (o *WebhookLog) GetAttemptOk() (*int32, bool)`

GetAttemptOk returns a tuple with the Attempt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetAttempt

`func (o *WebhookLog) SetAttempt(v int32)`

SetAttempt sets Attempt field to given value.

### HasAttempt

`func (o *WebhookLog) HasAttempt() bool`

HasAttempt returns a boolean if a field has been set.

### GetDurationMs

`func (o *WebhookLog) GetDurationMs() int32`

GetDurationMs returns the DurationMs field if non-nil, zero value otherwise.

### GetDurationMsOk

`func (o *WebhookLog) GetDurationMsOk() (*int32, bool)`

GetDurationMsOk returns a tuple with the DurationMs field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDurationMs

`func (o *WebhookLog) SetDurationMs(v int32)`

SetDurationMs sets DurationMs field to given value.

### HasDurationMs

`func (o *WebhookLog) HasDurationMs() bool`

HasDurationMs returns a boolean if a field has been set.

### GetTimestamp

`func (o *WebhookLog) GetTimestamp() time.Time`

GetTimestamp returns the Timestamp field if non-nil, zero value otherwise.

### GetTimestampOk

`func (o *WebhookLog) GetTimestampOk() (*time.Time, bool)`

GetTimestampOk returns a tuple with the Timestamp field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTimestamp

`func (o *WebhookLog) SetTimestamp(v time.Time)`

SetTimestamp sets Timestamp field to given value.

### HasTimestamp

`func (o *WebhookLog) HasTimestamp() bool`

HasTimestamp returns a boolean if a field has been set.

### GetError

`func (o *WebhookLog) GetError() string`

GetError returns the Error field if non-nil, zero value otherwise.

### GetErrorOk

`func (o *WebhookLog) GetErrorOk() (*string, bool)`

GetErrorOk returns a tuple with the Error field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetError

`func (o *WebhookLog) SetError(v string)`

SetError sets Error field to given value.

### HasError

`func (o *WebhookLog) HasError() bool`

HasError returns a boolean if a field has been set.

### SetErrorNil

`func (o *WebhookLog) SetErrorNil(b bool)`

 SetErrorNil sets the value for Error to be an explicit nil

### UnsetError
`func (o *WebhookLog) UnsetError()`

UnsetError ensures that no value is present for Error, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


