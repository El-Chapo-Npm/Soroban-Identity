# PaginatedCredentials


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**items** | [**List[Credential]**](Credential.md) |  | 
**next_cursor** | **str** |  | [optional] 

## Example

```python
from soroban_identity_client.models.paginated_credentials import PaginatedCredentials

# TODO update the JSON string below
json = "{}"
# create an instance of PaginatedCredentials from a JSON string
paginated_credentials_instance = PaginatedCredentials.from_json(json)
# print the JSON string representation of the object
print(PaginatedCredentials.to_json())

# convert the object into a dict
paginated_credentials_dict = paginated_credentials_instance.to_dict()
# create an instance of PaginatedCredentials from a dict
paginated_credentials_from_dict = PaginatedCredentials.from_dict(paginated_credentials_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


