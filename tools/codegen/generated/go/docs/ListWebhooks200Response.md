# ListWebhooks200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Webhooks** | Pointer to [**[]Webhook**](Webhook.md) |  | [optional] 

## Methods

### NewListWebhooks200Response

`func NewListWebhooks200Response() *ListWebhooks200Response`

NewListWebhooks200Response instantiates a new ListWebhooks200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewListWebhooks200ResponseWithDefaults

`func NewListWebhooks200ResponseWithDefaults() *ListWebhooks200Response`

NewListWebhooks200ResponseWithDefaults instantiates a new ListWebhooks200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetWebhooks

`func (o *ListWebhooks200Response) GetWebhooks() []Webhook`

GetWebhooks returns the Webhooks field if non-nil, zero value otherwise.

### GetWebhooksOk

`func (o *ListWebhooks200Response) GetWebhooksOk() (*[]Webhook, bool)`

GetWebhooksOk returns a tuple with the Webhooks field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetWebhooks

`func (o *ListWebhooks200Response) SetWebhooks(v []Webhook)`

SetWebhooks sets Webhooks field to given value.

### HasWebhooks

`func (o *ListWebhooks200Response) HasWebhooks() bool`

HasWebhooks returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


