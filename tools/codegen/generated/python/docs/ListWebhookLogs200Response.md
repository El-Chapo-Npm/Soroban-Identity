# ListWebhookLogs200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**logs** | [**List[WebhookLog]**](WebhookLog.md) |  | [optional] 

## Example

```python
from soroban_identity_client.models.list_webhook_logs200_response import ListWebhookLogs200Response

# TODO update the JSON string below
json = "{}"
# create an instance of ListWebhookLogs200Response from a JSON string
list_webhook_logs200_response_instance = ListWebhookLogs200Response.from_json(json)
# print the JSON string representation of the object
print(ListWebhookLogs200Response.to_json())

# convert the object into a dict
list_webhook_logs200_response_dict = list_webhook_logs200_response_instance.to_dict()
# create an instance of ListWebhookLogs200Response from a dict
list_webhook_logs200_response_from_dict = ListWebhookLogs200Response.from_dict(list_webhook_logs200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


