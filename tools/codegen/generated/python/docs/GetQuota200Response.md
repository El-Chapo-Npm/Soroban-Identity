# GetQuota200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**tier** | **str** |  | [optional] 
**daily** | [**GetQuota200ResponseDaily**](GetQuota200ResponseDaily.md) |  | [optional] 
**monthly** | [**GetQuota200ResponseMonthly**](GetQuota200ResponseMonthly.md) |  | [optional] 
**overage_mode** | **str** |  | [optional] 

## Example

```python
from soroban_identity_client.models.get_quota200_response import GetQuota200Response

# TODO update the JSON string below
json = "{}"
# create an instance of GetQuota200Response from a JSON string
get_quota200_response_instance = GetQuota200Response.from_json(json)
# print the JSON string representation of the object
print(GetQuota200Response.to_json())

# convert the object into a dict
get_quota200_response_dict = get_quota200_response_instance.to_dict()
# create an instance of GetQuota200Response from a dict
get_quota200_response_from_dict = GetQuota200Response.from_dict(get_quota200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


