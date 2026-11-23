# RegisterWebhookRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**url** | **str** |  | 
**events** | **List[str]** |  | [optional] [default to ["*"]]
**secret** | **str** |  | [optional] 
**auth_token** | **str** |  | [optional] 
**description** | **str** |  | [optional] 

## Example

```python
from soroban_identity_client.models.register_webhook_request import RegisterWebhookRequest

# TODO update the JSON string below
json = "{}"
# create an instance of RegisterWebhookRequest from a JSON string
register_webhook_request_instance = RegisterWebhookRequest.from_json(json)
# print the JSON string representation of the object
print(RegisterWebhookRequest.to_json())

# convert the object into a dict
register_webhook_request_dict = register_webhook_request_instance.to_dict()
# create an instance of RegisterWebhookRequest from a dict
register_webhook_request_from_dict = RegisterWebhookRequest.from_dict(register_webhook_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


